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

const Utils = require('../util/utils.js');

class Items {
    constructor() {
        this._items = JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'staticFiles', 'items.json'), 'utf8'));

        this._itemNames = Object.values(this.items).map(item => item.name);
    }

    /* Getters */
    get items() { return this._items; }
    get itemNames() { return this._itemNames; }

    addItem(id, content) { this.items[id] = content; }
    removeItem(id) { delete this.items[id]; }
    itemExist(id) { return (id in this.items) ? true : false; }

    getShortName(id) {
        if (!this.itemExist(id)) return undefined;
        return this.items[id].shortname;
    }

    getName(id) {
        if (!this.itemExist(id)) return undefined;
        return this.items[id].name;
    }

    getDescription(id) {
        if (!this.itemExist(id)) return undefined;
        return this.items[id].description;
    }

    getIdByName(name) {
        return Object.keys(this.items).find(id => this.items[id].name === name);
    }

    getClosestItemIdByName(name) {
        const closestString = Utils.findClosestString(name, this.itemNames);
        if (closestString !== null) {
            const id = Object.entries(this.items).find(([key, value]) => value.name === closestString);
            return id ? id[0] : null;
        }
        return null;
    }

    /**
     * Smarter item lookup used by the market commands. Unlike getClosestItemIdByName (which only
     * tolerates a couple of typos against the full item name), this matches partial names, individual
     * words, shortnames and abbreviations so the user does not have to type the exact in-game name.
     * Examples: "rifle" -> "Assault Rifle", "sheet metal" -> "Sheet Metal Double Door",
     * "ak" -> "Assault Rifle" (via shortname "rifle.ak"), "hqm" -> "High Quality Metal".
     */
    getClosestItemIdByNameSmart(name) {
        if (name === null || name === undefined) return null;

        const query = name.toString().toLowerCase().trim().replace(/\s+/g, ' ');
        if (query === '') return null;

        const queryTokens = query.split(' ').filter(token => token.length > 0);

        let bestId = null;
        let bestScore = 0;
        let bestNameLength = Infinity;

        for (const [id, item] of Object.entries(this.items)) {
            const itemName = (item.name || '').toLowerCase();
            const shortName = (item.shortname || '').toLowerCase();

            const score = this.scoreItemMatch(query, queryTokens, itemName, shortName);
            if (score <= 0) continue;

            /* Highest score wins; on a tie prefer the shorter (more specific) item name. */
            if (score > bestScore || (score === bestScore && itemName.length < bestNameLength)) {
                bestScore = score;
                bestNameLength = itemName.length;
                bestId = id;
            }
        }

        if (bestId !== null) return bestId;

        /* Fall back to the original near-exact matching to keep handling whole-name typos. */
        return this.getClosestItemIdByName(query);
    }

    /**
     * Score how well an item matches the search query. Higher is better, 0 means no match.
     * Tiers are spaced far apart so a better match category always beats a weaker one.
     */
    scoreItemMatch(query, queryTokens, itemName, shortName) {
        const shortNameCompact = shortName.replace(/[^a-z0-9]/g, '');
        const nameTokens = itemName.split(/[^a-z0-9]+/).filter(token => token.length > 0);

        /* Exact matches. */
        if (itemName === query) return 1000;
        if (shortName === query || shortNameCompact === query) return 950;

        /* The item name (or shortname) starts with what was typed. */
        if (itemName.startsWith(query)) return 900 - (itemName.length - query.length);
        if (shortNameCompact.startsWith(query)) return 850 - (shortNameCompact.length - query.length);

        /* A single word inside the item name starts with the query. */
        if (nameTokens.some(token => token.startsWith(query))) return 800;

        /* The query appears somewhere inside the name or shortname. */
        if (itemName.includes(query)) return 700 - (itemName.length - query.length);
        if (shortNameCompact.includes(query)) return 650;

        /* Multi-word query: every typed word appears somewhere in the item name. */
        if (queryTokens.length > 1 && queryTokens.every(token => itemName.includes(token))) return 600;

        /* Every typed word is the prefix of some word in the item name (e.g. "ass rif"). */
        if (queryTokens.every(token => nameTokens.some(nameToken => nameToken.startsWith(token)))) return 550;

        /* Abbreviation/initials: typed letters match the first letter of each name word (e.g. "hqm"). */
        if (queryTokens.length === 1 && query.length >= 2 && query.length === nameTokens.length &&
            nameTokens.every((token, i) => token.startsWith(query[i]))) return 500;

        /* Fuzzy fallback for typos in a single word, scaled by similarity. */
        const distance = Utils.levenshteinDistance(query, itemName);
        const maxLength = Math.max(query.length, itemName.length);
        if (maxLength > 0) {
            const similarity = 1 - (distance / maxLength);
            /* Only accept reasonably close fuzzy matches. */
            if (similarity >= 0.7) return Math.round(similarity * 400);
        }

        return 0;
    }
}

module.exports = Items;