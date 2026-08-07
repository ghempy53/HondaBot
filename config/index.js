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

module.exports = {
    general: {
        language: process.env.RPP_LANGUAGE || 'en',
        // FIX: Parse as integer since env vars are strings
        pollingIntervalMs: parseInt(process.env.RPP_POLLING_INTERVAL, 10) || 10000,
        // FIX: Properly parse boolean from string - only true if explicitly 'true'
        showCallStackError: process.env.RPP_LOG_CALL_STACK === 'true',
        // FIX: Parse as integer since env vars are strings
        reconnectIntervalMs: parseInt(process.env.RPP_RECONNECT_INTERVAL, 10) || 15000,
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'rustplusplus',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
        // FIX: Properly parse boolean - default to true unless explicitly set to 'false'
        needAdminPrivileges: process.env.RPP_NEED_ADMIN_PRIVILEGES !== 'false',
    },
    battlemetrics: {
        /* Auth token. Optional -- BattleMetrics limits Personal Access Tokens to paid
           subscribers, but the public server/player/leaderboard endpoints this bot uses
           serve fine unauthenticated (60 req/min, 15 req/sec). Supplying a token only
           raises those ceilings to 300/min and 45/sec. */
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
        /* Whether BattleMetrics features (trackers, /players, server BM info) are active.
           Upstream keys this off the token being present, which silently disables every
           tracker feature for anyone without a subscription. Decoupled here so the
           features run unauthenticated by default; set to 'false' to turn them off. */
        enabled: process.env.RPP_BATTLEMETRICS_ENABLED !== 'false'
    }
};
