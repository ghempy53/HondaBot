/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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

const Constants = require("../util/constants");

/* Rust+ server rejects messages sent faster than ~1/sec with `message_not_sent`
   or `rate_limit`. The commandDelay user setting defaults to 0, so multi-line
   replies (e.g. `!market search`) flush back-to-back and get rejected by the
   server. Enforce a floor independent of the user setting. */
const MIN_IN_GAME_CHAT_DELAY_MS = 1500;

module.exports = {
    inGameChatHandler: async function (rustplus, client, message = null, skipTrademark = false) {
        const guildId = rustplus.guildId;
        const generalSettings = rustplus.generalSettings;
        const userDelayMs = parseInt(generalSettings.commandDelay) * 1000;
        const commandDelayMs = Math.max(userDelayMs || 0, MIN_IN_GAME_CHAT_DELAY_MS);
        const trademark = generalSettings.trademark;
        const trademarkString = (trademark === 'NOT SHOWING' || skipTrademark) ? '' : `${trademark} | `;
        const messageMaxLength = Constants.MAX_LENGTH_TEAM_MESSAGE - trademarkString.length;

        /* Time to write a message from the queue. If message === null, that means that its a timer call. */
        if (message === null) {
            if (rustplus.inGameChatQueue.length !== 0) {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;

                const messageFromQueue = rustplus.inGameChatQueue[0];
                rustplus.inGameChatQueue = rustplus.inGameChatQueue.slice(1);

                rustplus.updateBotMessages(messageFromQueue);

                rustplus.log(client.intlGet(guildId, 'messageCap'), messageFromQueue);
                rustplus.sendTeamMessageAsync(messageFromQueue).then((result) => {
                    /* sendTeamMessageAsync resolves to the AppResponse on success, or returns
                       an Error/{error} on failure (it .catch()es internally). Surface failures
                       so a silent server timeout doesn't masquerade as a successful send. */
                    if (result instanceof Error) {
                        rustplus.log(client.intlGet(null, 'errorCap'),
                            `In-game message dropped (${result.message}): ${messageFromQueue}`, 'error');
                    }
                    else if (result && result.error) {
                        rustplus.log(client.intlGet(null, 'errorCap'),
                            `In-game message rejected (${JSON.stringify(result.error)}): ${messageFromQueue}`, 'error');
                    }
                });
            }
            else {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;
            }
        }

        /* if there is a new message, add message to queue. */
        if (message !== null) {
            if (rustplus.team === null || rustplus.team.allOffline ||
                rustplus.generalSettings.muteInGameBotMessages) {
                return;
            }

            if (Array.isArray(message)) {
                for (const msg of message) {
                    handleMessage(rustplus, msg, trademarkString, messageMaxLength)
                }
            }
            else if (typeof message === 'string') {
                handleMessage(rustplus, message, trademarkString, messageMaxLength)
            }
        }

        /* Start new timer? */
        if (rustplus.inGameChatQueue.length !== 0 && rustplus.inGameChatTimeout === null) {
            rustplus.inGameChatTimeout = setTimeout(module.exports.inGameChatHandler, commandDelayMs, rustplus, client);
        }
    },
};

function handleMessage(rustplus, message, trademarkString, maxLength) {
    if (typeof message !== 'string') return;

    const strings = message.match(new RegExp(`.{1,${maxLength}}(\\s|$)`, 'g'));

    for (const str of strings) {
        rustplus.inGameChatQueue.push(`${trademarkString}${str}`);
    }
}
