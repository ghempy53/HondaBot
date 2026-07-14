/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const Fs = require('fs');
const Path = require('path');

const Client = require('../../index');

/* Debounced instance-file writer.

   setInstance() is called on nearly every state mutation (smart switch
   toggles, team changes, message id updates, ...). Previously each call did a
   synchronous, pretty-printed JSON write, blocking the event loop many times
   per polling cycle. Instead, coalesce writes per guild: keep the latest
   instance reference and flush it asynchronously (tmp file + atomic rename)
   after a short delay. Pending writes are flushed synchronously on process
   exit (see flushInstanceFiles + hooks in index.ts). */
const WRITE_DEBOUNCE_MS = 1000;
const pendingInstanceWrites = new Map();    /* guildId -> { instance, timer } */

function instancePath(guildId) {
    return Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
}

async function flushInstanceWrite(guildId) {
    const pending = pendingInstanceWrites.get(guildId);
    if (!pending) return;
    pendingInstanceWrites.delete(guildId);

    const path = instancePath(guildId);
    const tmpPath = `${path}.tmp`;
    try {
        await Fs.promises.writeFile(tmpPath, JSON.stringify(pending.instance, null, 2));
        await Fs.promises.rename(tmpPath, path);
    }
    catch (e) {
        /* Fall back to a direct synchronous write on any failure. */
        try {
            Fs.writeFileSync(path, JSON.stringify(pending.instance, null, 2));
        }
        catch (e2) {
            console.error(`Failed to write instance file for guild ${guildId}:`, e2);
        }
    }
}

module.exports = {
    getSmartDevice: function (guildId, entityId) {
        /* Temporary function till discord modals gets more functional */
        const instance = Client.client.getInstance(guildId);

        for (const serverId in instance.serverList) {
            for (const switchId in instance.serverList[serverId].switches) {
                if (entityId === switchId) return { type: 'switch', serverId: serverId }
            }
            for (const alarmId in instance.serverList[serverId].alarms) {
                if (entityId === alarmId) return { type: 'alarm', serverId: serverId }
            }
            for (const storageMonitorId in instance.serverList[serverId].storageMonitors) {
                if (entityId === storageMonitorId) return { type: 'storageMonitor', serverId: serverId }
            }
        }
        return null;
    },

    readInstanceFile: function (guildId) {
        /* If a write is still pending for this guild, the in-memory state is
           newer than what is on disk. */
        const pending = pendingInstanceWrites.get(guildId);
        if (pending) return pending.instance;

        const path = instancePath(guildId);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeInstanceFile: function (guildId, instance) {
        const existing = pendingInstanceWrites.get(guildId);
        if (existing) {
            /* A write is already scheduled; just update the payload. */
            existing.instance = instance;
            return;
        }

        const timer = setTimeout(() => flushInstanceWrite(guildId), WRITE_DEBOUNCE_MS);
        /* Don't let a pending write keep the process alive. */
        if (timer.unref) timer.unref();
        pendingInstanceWrites.set(guildId, { instance: instance, timer: timer });
    },

    /* Synchronously flush all pending instance writes. Called on process
       exit/termination so no state is lost across restarts. */
    flushInstanceFiles: function () {
        for (const [guildId, pending] of pendingInstanceWrites) {
            clearTimeout(pending.timer);
            try {
                Fs.writeFileSync(instancePath(guildId), JSON.stringify(pending.instance, null, 2));
            }
            catch (e) {
                console.error(`Failed to flush instance file for guild ${guildId}:`, e);
            }
        }
        pendingInstanceWrites.clear();
    },

    readCredentialsFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeCredentialsFile: function (guildId, credentials) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        Fs.writeFileSync(path, JSON.stringify(credentials, null, 2));
    },
}
