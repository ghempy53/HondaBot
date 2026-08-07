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
const sharp = require('sharp');

const Client = require('../../index');

/* Discord rejects attachments above 10 MiB on non-boosted guilds with
   DiscordAPIError[40005] "Request entity too large". A full-map render on a
   large monthly map, with markers and helicopter tracers composited on top,
   can clear that -- and because the map is sent via message *edit*, the
   failure is silent to users: the map simply stops updating.

   Rather than dropping the message, downscale until it fits. Target well
   under the cap to leave room for the multipart envelope and the embed. */
const MAX_MAP_ATTACHMENT_BYTES = 9 * 1024 * 1024;

/* Progressively more aggressive attempts. Palette-quantized PNG is very
   effective on map renders (large flat-colour regions), and Discord displays
   the embed image around 800px wide, so 2048 is already generous. */
const MAP_COMPRESSION_STEPS = [
    { maxDimension: null, palette: true },
    { maxDimension: 2048, palette: true },
    { maxDimension: 1536, palette: true },
    { maxDimension: 1024, palette: true }
];

module.exports = {
    gridDiameter: 146.25,

    /**
     *  Build a Discord attachment for a generated map image, compressing it
     *  first if it would exceed Discord's upload limit.
     *
     *  The returned attachment always keeps the original filename, because
     *  discordEmbeds.js references it as `attachment://<guildId>_map_full.png`.
     *  Renaming it would break that reference.
     *
     *  @param {string} mapPath Absolute path to the map image on disk.
     *  @return {object} A Discord.AttachmentBuilder.
     */
    getMapAttachment: async function (mapPath) {
        const name = Path.basename(mapPath);

        let size = null;
        try {
            size = (await Fs.promises.stat(mapPath)).size;
        }
        catch (e) {
            /* Missing or unreadable -- hand back the path and let the caller's
               existing error handling report it, same as before. */
            return new Discord.AttachmentBuilder(mapPath, { name: name });
        }

        if (size <= MAX_MAP_ATTACHMENT_BYTES) {
            return new Discord.AttachmentBuilder(mapPath, { name: name });
        }

        for (const step of MAP_COMPRESSION_STEPS) {
            try {
                let pipeline = sharp(mapPath);

                if (step.maxDimension !== null) {
                    pipeline = pipeline.resize(step.maxDimension, step.maxDimension, {
                        fit: 'inside',
                        withoutEnlargement: true
                    });
                }

                const buffer = await pipeline
                    .png({ compressionLevel: 9, palette: step.palette })
                    .toBuffer();

                if (buffer.length <= MAX_MAP_ATTACHMENT_BYTES) {
                    Client.client.log(Client.client.intlGet(null, 'infoCap'),
                        `Map image compressed from ${Math.round(size / 1024)}KB to ` +
                        `${Math.round(buffer.length / 1024)}KB to fit Discord's upload limit.`);
                    return new Discord.AttachmentBuilder(buffer, { name: name });
                }
            }
            catch (e) {
                /* Try the next, more aggressive step. */
            }
        }

        /* Nothing fit. Return the original so the failure surfaces in logs the
           way it does today rather than silently sending nothing. */
        Client.client.log(Client.client.intlGet(null, 'errorCap'),
            `Map image (${Math.round(size / 1024)}KB) could not be compressed under ` +
            `Discord's upload limit; the send will likely fail.`, 'error');
        return new Discord.AttachmentBuilder(mapPath, { name: name });
    },

    getPos: function (x, y, mapSize, rustplus) {
        const correctedMapSize = module.exports.getCorrectedMapSize(mapSize);
        const pos = { location: null, monument: null, string: null, x: x, y: y }

        if (module.exports.isOutsideGridSystem(x, y, correctedMapSize)) {
            if (module.exports.isOutsideRowOrColumn(x, y, correctedMapSize)) {
                if (x < 0 && y > correctedMapSize) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'northWest');
                }
                else if (x < 0 && y < 0) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'southWest');
                }
                else if (x > correctedMapSize && y > correctedMapSize) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'northEast');
                }
                else {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'southEast');
                }
            }
            else {
                let str = '';
                if (x < 0 || x > correctedMapSize) {
                    str += (x < 0) ? Client.client.intlGet(rustplus.guildId, 'westOfGrid') :
                        Client.client.intlGet(rustplus.guildId, 'eastOfGrid');
                    str += ` ${module.exports.getGridPosNumberY(y, correctedMapSize)}`;
                }
                else {
                    str += (y < 0) ? Client.client.intlGet(rustplus.guildId, 'southOfGrid') :
                        Client.client.intlGet(rustplus.guildId, 'northOfGrid');
                    str += ` ${module.exports.getGridPosLettersX(x, correctedMapSize)}`;
                }
                pos.location = str;
            }
        }
        else {
            pos.location = module.exports.getGridPos(x, y, mapSize);
        }

        const monuments = rustplus.map?.monuments;
        const monumentInfo = rustplus.map?.monumentInfo;
        for (const monument of (Array.isArray(monuments) ? monuments : [])) {
            if (monument.token === 'DungeonBase' || !monumentInfo || !(monument.token in monumentInfo)) continue;
            if (module.exports.getDistance(x, y, monument.x, monument.y) <=
                monumentInfo[monument.token].radius) {
                pos.monument = monumentInfo[monument.token].clean;
                break;
            }
        }

        pos.string = `${pos.location}${pos.monument !== null ? ` (${pos.monument})` : ''}`;

        return pos;
    },

    getGridPos: function (x, y, mapSize) {
        const correctedMapSize = module.exports.getCorrectedMapSize(mapSize);

        /* Outside the grid system */
        if (module.exports.isOutsideGridSystem(x, y, correctedMapSize)) {
            return null;
        }

        const gridPosLetters = module.exports.getGridPosLettersX(x, correctedMapSize);
        const gridPosNumber = module.exports.getGridPosNumberY(y, correctedMapSize);

        return gridPosLetters + gridPosNumber;
    },

    getGridPosLettersX: function (x, mapSize) {
        let counter = 1;
        for (let startGrid = 0; startGrid < mapSize; startGrid += module.exports.gridDiameter) {
            if (x >= startGrid && x <= (startGrid + module.exports.gridDiameter)) {
                /* We're at the correct grid! */
                return module.exports.numberToLetters(counter);
            }
            counter++;
        }
    },

    getGridPosNumberY: function (y, mapSize) {
        let counter = 1;
        const numberOfGrids = Math.floor(mapSize / module.exports.gridDiameter);
        for (let startGrid = 0; startGrid < mapSize; startGrid += module.exports.gridDiameter) {
            if (y >= startGrid && y <= (startGrid + module.exports.gridDiameter)) {
                /* We're at the correct grid! */
                return numberOfGrids - counter;
            }
            counter++;
        }
    },

    numberToLetters: function (num) {
        const mod = num % 26;
        let pow = num / 26 | 0;
        const out = mod ? String.fromCharCode(64 + mod) : (pow--, 'Z');
        return pow ? module.exports.numberToLetters(pow) + out : out;
    },

    getCorrectedMapSize: function (mapSize) {
        const remainder = mapSize % module.exports.gridDiameter;
        const offset = module.exports.gridDiameter - remainder;
        return (remainder < 120) ? mapSize - remainder : mapSize + offset;
    },

    getAngleBetweenPoints: function (x1, y1, x2, y2) {
        let angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

        if (angle < 0) {
            angle = 360 + angle;
        }

        return Math.floor((Math.abs(angle - 360) + 90) % 360);
    },

    getDistance: function (x1, y1, x2, y2) {
        /* Pythagoras is the man! */
        const a = x1 - x2;
        const b = y1 - y2;
        return Math.sqrt(a * a + b * b);
    },

    isOutsideGridSystem: function (x, y, mapSize, offset = 0) {
        if (x < -offset || x > (mapSize + offset) || y < -offset || y > (mapSize + offset)) {
            return true;
        }
        return false;
    },

    isOutsideRowOrColumn: function (x, y, mapSize) {
        if ((x < 0 && y > mapSize) || (x < 0 && y < 0) || (x > mapSize && y > mapSize) || (x > mapSize && y < 0)) {
            return true;
        }
        return false;
    },
}