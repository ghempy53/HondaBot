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

const Discord = require('discord.js');
const Fs = require('fs');
const Path = require('path');

const DiscordBot = require('./src/structures/DiscordBot');

/* Suppress the Node.js DEP0040 `punycode` deprecation warning emitted by a
   transitive dependency we don't control. */
process.on('warning', (warning: NodeJS.ErrnoException) => {
    if (warning.name === 'DeprecationWarning' && warning.code === 'DEP0040') return;
    console.warn(warning);
});

/* The @liamcottle/push-receiver library logs `Request failed : ...` and
   `Retrying in N seconds` directly to console.error on every failed
   checkin/register call. When the network or DNS is down those lines pile up
   indefinitely. Wrap console.log/console.error to log only the first
   occurrence, then a single summary line every minute, until the next
   success. */
(() => {
    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);
    let suppressedSince: number | null = null;
    let suppressedCount = 0;
    let lastSummaryAt = 0;
    const SUMMARY_INTERVAL_MS = 60000;

    const isFcmRetryNoise = (args: unknown[]): boolean => {
        if (args.length === 0) return false;
        const joined = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
        return joined.startsWith('Request failed : ') ||
            /^Retrying in \d+ seconds?$/.test(joined);
    };

    const wrap = (emit: (...a: unknown[]) => void) => (...args: unknown[]) => {
        if (isFcmRetryNoise(args)) {
            const now = Date.now();
            if (suppressedSince === null) {
                suppressedSince = now;
                lastSummaryAt = now;
                emit(...args);
                emit('(further FCM retry messages will be summarized while the failure persists)');
                return;
            }
            suppressedCount += 1;
            if (now - lastSummaryAt >= SUMMARY_INTERVAL_MS) {
                lastSummaryAt = now;
                emit(`(suppressed ${suppressedCount} FCM retry messages in the last ` +
                    `${Math.round((now - suppressedSince) / 1000)}s)`);
            }
            return;
        }
        if (suppressedSince !== null) {
            const elapsed = Math.round((Date.now() - suppressedSince) / 1000);
            emit(`(FCM retry noise ended; suppressed ${suppressedCount} message` +
                `${suppressedCount === 1 ? '' : 's'} over ${elapsed}s)`);
            suppressedSince = null;
            suppressedCount = 0;
            lastSummaryAt = 0;
        }
        emit(...args);
    };

    console.log = wrap(originalLog);
    console.error = wrap(originalError);
})();

createMissingDirectories();

// FIXED: Discord.js v14 compatible options
// Removed: disableEveryone (removed in v14)
// Changed: restRequestTimeout -> rest.timeout
// Changed: retryLimit -> rest.retries
const client = new DiscordBot({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildVoiceStates
    ],
    rest: {
        timeout: 60000,
        retries: 2
    }
    // NOTE: disableEveryone was removed in discord.js v14
});

client.build();

function createMissingDirectories() {
    const directories = ['logs', 'instances', 'credentials', 'maps'];
    
    for (const dir of directories) {
        const dirPath = Path.join(__dirname, dir);
        if (!Fs.existsSync(dirPath)) {
            Fs.mkdirSync(dirPath, { recursive: true });
        }
    }
}

process.on('unhandledRejection', error => {
    client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'unhandledRejection', {
        error: error
    }), 'error');
    console.log(error);
});

/* Instance-file writes are debounced (see src/util/instanceUtils.js); flush
   any pending writes before the process goes down so no state is lost. */
const flushInstanceFiles = () => {
    try {
        require('./src/util/instanceUtils.js').flushInstanceFiles();
    }
    catch (e) {
        /* Ignore */
    }
};

process.on('exit', flushInstanceFiles);
process.on('SIGINT', () => {
    flushInstanceFiles();
    process.exit(0);
});
process.on('SIGTERM', () => {
    flushInstanceFiles();
    process.exit(0);
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
    flushInstanceFiles();
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

exports.client = client;
