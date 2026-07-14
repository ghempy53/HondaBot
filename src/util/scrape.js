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

const Axios = require('axios');

const Constants = require('../util/constants.js');
const Utils = require('../util/utils.js');

/* TTL caches for Steam profile lookups. Every activity notification
   (connect/disconnect/death) previously downloaded the full Steam profile
   HTML page just to extract the avatar URL, and tracker updates re-scraped
   persona names for every tracked player. Cache results to avoid hammering
   Steam and to make notifications faster. Failures are cached briefly so a
   Steam outage doesn't trigger a request per notification. */
const PICTURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   /* Avatars rarely change. */
const NAME_CACHE_TTL_MS = 10 * 60 * 1000;           /* Name changes should still be noticed. */
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

const profilePictureCache = new Map();  /* steamId -> { value, expiresAt } */
const profileNameCache = new Map();     /* steamId -> { value, expiresAt } */

function cacheGet(cache, key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return undefined;
    }
    return entry;
}

function cacheSet(cache, key, value, ttl) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        /* Drop the oldest entry to bound memory over 24/7 runtime. */
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, { value: value, expiresAt: Date.now() + ttl });
}

module.exports = {
    scrape: async function (url) {
        try {
            return await Axios.get(url);
        }
        catch (e) {
            return {};
        }
    },

    scrapeSteamProfilePicture: async function (client, steamId) {
        const cached = cacheGet(profilePictureCache, steamId);
        if (cached !== undefined) return cached.value;

        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfilePicture', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            cacheSet(profilePictureCache, steamId, null, FAILURE_CACHE_TTL_MS);
            return null;
        }

        let png = response.data.match(/<img src="(.*_full.jpg)(.*?(?="))/);
        const result = png ? png[1] : null;
        cacheSet(profilePictureCache, steamId, result,
            result !== null ? PICTURE_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS);
        return result;
    },

    scrapeSteamProfileName: async function (client, steamId) {
        const cached = cacheGet(profileNameCache, steamId);
        if (cached !== undefined) return cached.value;

        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfileName', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            cacheSet(profileNameCache, steamId, null, FAILURE_CACHE_TTL_MS);
            return null;
        }

        let regex = new RegExp(`class="actual_persona_name">(.+?)</span>`, 'gm');
        let data = regex.exec(response.data);
        const result = data ? Utils.decodeHtml(data[1]) : null;
        cacheSet(profileNameCache, steamId, result,
            result !== null ? NAME_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS);
        return result;
    },
}