"use strict";

const path = require('path');
const WebSocket = require('ws');
const protobuf = require("protobufjs");
const { EventEmitter } = require('events');
const Camera = require('./camera');

class RustPlus extends EventEmitter {

    /**
     * @param server The ip address or hostname of the Rust Server
     * @param port The port of the Rust Server (app.port in server.cfg)
     * @param playerId SteamId of the Player
     * @param playerToken Player Token from Server Pairing
     * @param useFacepunchProxy True to use secure websocket via Facepunch's proxy, or false to directly connect to Rust Server
     *
     * Events emitted by the RustPlus class instance
     * - connecting: When we are connecting to the Rust Server.
     * - connected: When we are connected to the Rust Server.
     * - message: When an AppMessage has been received from the Rust Server.
     * - request: When an AppRequest has been sent to the Rust Server.
     * - disconnected: When we are disconnected from the Rust Server.
     * - error: When something goes wrong.
     */
    constructor(server, port, playerId, playerToken, useFacepunchProxy = false) {

        super();

        this.server = server;
        this.port = port;
        this.playerId = playerId;
        this.playerToken = playerToken;
        this.useFacepunchProxy = useFacepunchProxy;

        this.seq = 0;
        this.seqCallbacks = [];

    }

    /**
     * This sets everything up and then connects to the Rust Server via WebSocket.
     */
    connect() {

        // load protobuf then connect
        protobuf.load(path.resolve(__dirname, "rustplus.proto")).then((root) => {

            // make sure existing connection is disconnected before connecting again.
            if(this.websocket){
                this.disconnect();
            }

            // load proto types
            this.AppRequest = root.lookupType("rustplus.AppRequest");
            this.AppMessage = root.lookupType("rustplus.AppMessage");

            // fire event as we are connecting
            this.emit('connecting');

            // connect to websocket
            var address = this.useFacepunchProxy ? `wss://companion-rust.facepunch.com/game/${this.server}/${this.port}` : `ws://${this.server}:${this.port}`;
            this.websocket = new WebSocket(address);

            // fire event when connected
            this.websocket.on('open', () => {
                this.emit('connected');
            });

            // fire event for websocket errors
            this.websocket.on('error', (e) => {
                this.emit('error', e);
            });

            this.websocket.on('message', (data) => {

                try {

                    // decode received message
                    var message = this.AppMessage.decode(data);

                    // check if received message is a response and if we have a callback registered for it
                    if(message.response && message.response.seq && this.seqCallbacks[message.response.seq]){

                        // get the callback for the response sequence
                        var callback = this.seqCallbacks[message.response.seq];

                        // call the callback with the response message
                        var result = callback(message);

                        // remove the callback
                        delete this.seqCallbacks[message.response.seq];

                        // if callback returns true, don't fire message event
                        if(result){
                            return;
                        }

                    }

                    // fire message event for received messages that aren't handled by callback
                    this.emit('message', this.AppMessage.decode(data));

                } catch (err) {
                    this.emit('error', err);
                }

            });

            // fire event when disconnected
            this.websocket.on('close', () => {
                // Reject any in-flight request callbacks so the awaiting
                // promises don't sit until their own 10s timeout fires
                // (and so we don't leak the callback entries).
                const closedError = new Error('WebSocket closed before response was received');
                const pendingSeqs = Object.keys(this.seqCallbacks);
                for (const seq of pendingSeqs) {
                    const cb = this.seqCallbacks[seq];
                    delete this.seqCallbacks[seq];
                    try { cb({ response: { seq: Number(seq), error: closedError } }); }
                    catch (_) { /* swallow callback errors during teardown */ }
                }
                this.emit('disconnected');
            });

        });

    }

    /**
     * Disconnect from the Rust Server.
     */
    disconnect() {
        if(this.websocket){
            this.websocket.terminate();
            this.websocket = null;
        }
    }

    /**
     * Check if RustPlus is connected to the server.
     * @returns {boolean}
     */
    isConnected() {
        return this.websocket != null;
    }

    /**
     * Send a Request to the Rust Server with an optional callback when a Response is received.
     * @param data this should contain valid data for the AppRequest packet in the rustplus.proto schema file
     * @param callback
     */
    sendRequest(data, callback) {

        // Guard: don't try to send on a missing or non-open socket. Without
        // this, send() throws when the socket has been nulled by disconnect()
        // (race with in-flight async requests) or when readyState is
        // CONNECTING/CLOSING/CLOSED.
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            const err = new Error('WebSocket is not open');
            if (callback) {
                // Defer to next tick so callers (sendRequestAsync) get a clean
                // rejection path instead of a synchronous throw.
                setImmediate(() => {
                    try { callback({ response: { seq: 0, error: err } }); }
                    catch (_) { /* swallow */ }
                });
                return;
            }
            throw err;
        }

        // increment sequence number
        let currentSeq = ++this.seq;

        // save callback if provided
        if(callback){
            this.seqCallbacks[currentSeq] = callback;
        }

        // create protobuf from AppRequest packet
        let request = this.AppRequest.fromObject({
            seq: currentSeq,
            playerId: this.playerId,
            playerToken: this.playerToken,
            ...data, // merge in provided data for AppRequest
        });

        // send AppRequest packet to rust server
        try {
            this.websocket.send(this.AppRequest.encode(request).finish());
        }
        catch (e) {
            // If send() throws synchronously after our guard, drop the
            // callback entry and surface the error via the same callback
            // shape sendRequestAsync expects.
            if (callback) {
                delete this.seqCallbacks[currentSeq];
                try { callback({ response: { seq: currentSeq, error: e } }); }
                catch (_) { /* swallow */ }
                return;
            }
            throw e;
        }

        // fire event when request has been sent, this is useful for logging
        this.emit('request', request);

    }

    /**
     * Send a Request to the Rust Server and return a Promise
     * @param data this should contain valid data for the AppRequest packet defined in the rustplus.proto schema file
     * @param timeoutMilliseconds milliseconds before the promise will be rejected. Defaults to 10 seconds.
     */
    sendRequestAsync(data, timeoutMilliseconds = 10000) {
        return new Promise((resolve, reject) => {

            // Capture the current seq so the timeout handler can remove the
            // leaked callback entry. sendRequest increments this.seq, so the
            // value we want is this.seq + 1 *before* it's called. We can't
            // know the seq before sendRequest runs, so we track it after.
            let registeredSeq = null;

            // reject promise after timeout
            var timeout = setTimeout(() => {
                // Drop the leaked callback so it doesn't pin memory and so
                // a late reply doesn't fire into a stale closure.
                if (registeredSeq !== null) {
                    delete this.seqCallbacks[registeredSeq];
                }
                reject(new Error('Timeout reached while waiting for response'));
            }, timeoutMilliseconds);

            // send request
            this.sendRequest(data, (message) => {

                // cancel timeout
                clearTimeout(timeout);

                if(message.response.error){

                    // reject promise if server returns an AppError for this request
                    reject(message.response.error);

                } else {

                    // request was successful, resolve with message.response
                    resolve(message.response);

                }

            });

            // Record the seq we just used so the timeout can clean it up.
            // sendRequest just did ++this.seq, so the active key is this.seq.
            registeredSeq = this.seq;

        });
    }

    /**
     * Send a Request to the Rust Server to set the Entity Value.
     * @param entityId the entity id to set the value for
     * @param value the value to set on the entity
     * @param callback
     */
    setEntityValue(entityId, value, callback) {
        this.sendRequest({
            entityId: entityId,
            setEntityValue: {
                value: value,
            },
        }, callback);
    }

    /**
     * Turn a Smart Switch On
     * @param entityId the entity id of the smart switch to turn on
     * @param callback
     */
    turnSmartSwitchOn(entityId, callback) {
        this.setEntityValue(entityId, true, callback);
    }

    /**
     * Turn a Smart Switch Off
     * @param entityId the entity id of the smart switch to turn off
     * @param callback
     */
    turnSmartSwitchOff(entityId, callback) {
        this.setEntityValue(entityId, false, callback);
    }

    /**
     * Quickly turn on and off a Smart Switch as if it were a Strobe Light.
     * You will get rate limited by the Rust Server after a short period.
     * It was interesting to watch in game though 😝
     */
    strobe(entityId, timeoutMilliseconds = 100, value = true) {
        this.setEntityValue(entityId, value);
        setTimeout(() => {
            this.strobe(entityId, timeoutMilliseconds, !value);
        }, timeoutMilliseconds);
    }

    /**
     * Send a message to Team Chat
     * @param message the message to send to team chat
     * @param callback
     */
    sendTeamMessage(message, callback) {
        this.sendRequest({
            sendTeamMessage: {
                message: message,
            },
        }, callback);
    }

    /**
     * Get info for an Entity
     * @param entityId the id of the entity to get info of
     * @param callback
     */
    getEntityInfo(entityId, callback) {
        this.sendRequest({
            entityId: entityId,
            getEntityInfo: {

            },
        }, callback);
    }

    /**
     * Get the Map
     */
    getMap(callback) {
        this.sendRequest({
            getMap: {

            },
        }, callback);
    }
    
    /**
     * Get the ingame time
    */
    getTime(callback) {
        this.sendRequest({
            getTime: {

            },
        }, callback);
    }

    /**
     * Get all map markers
     */
    getMapMarkers(callback) {
        this.sendRequest({
            getMapMarkers: {

            },
        }, callback);
    }

    /**
     * Get the server info
     */
    getInfo(callback) {
        this.sendRequest({
            getInfo: {

            },
        }, callback);
    }

    /**
     * Get team info
     */
    getTeamInfo(callback) {
        this.sendRequest({
            getTeamInfo: {

            },
        }, callback);
    }

    /**
     * Subscribes to a Camera
     * @param identifier Camera Identifier, such as OILRIG1 (or custom name)
     * @param callback
     */
    subscribeToCamera(identifier, callback) {
        this.sendRequest({
            cameraSubscribe: {
                cameraId: identifier,
            },
        }, callback);
    }

    /**
     * Unsubscribes from a Camera
     * @param identifier Camera Identifier
     * @param callback
     */
    unsubscribeFromCamera(identifier, callback) {
        this.sendRequest({
            cameraUnsubscribe: {

            }
        }, callback)
    }

    /**
     * Sends camera input to the server (mouse movement)
     * @param buttons The buttons that are currently pressed
     * @param x The x delta of the mouse movement
     * @param y The y delta of the mouse movement
     * @param callback
     */
    sendCameraInput(buttons, x, y, callback) {
        this.sendRequest({
            cameraInput: {
                buttons: buttons,
                mouseDelta: {
                    x: x,
                    y: y,
                }
            },
        }, callback);
    }

    /**
     * Get a camera instance for controlling CCTV Cameras, PTZ Cameras and  Auto Turrets
     * @param identifier Camera Identifier, such as DOME1, OILRIG1L1, (or a custom camera id)
     * @returns {Camera}
     */
    getCamera(identifier) {
        return new Camera(this, identifier);
    }

}

module.exports = RustPlus;
