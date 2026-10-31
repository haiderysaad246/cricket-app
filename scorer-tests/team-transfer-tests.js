const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const teamPath = require.resolve(path.join(root, 'models/team.model.js'));
const controllerPath = require.resolve(path.join(root, 'controllers/teams.api.controller.js'));
const players = new Map([
    ['p1', { _id: 'p1', name: 'Transferred Player' }],
    ['p2', { _id: 'p2', name: 'Remaining Player' }],
    ['p3', { _id: 'p3', name: 'Target Player' }],
    ['p4', { _id: 'p4', name: 'New Player' }],
]);
let teams;
let nextTeamId;

const clone = (value) => JSON.parse(JSON.stringify(value));
function normalizePlayerId(player) {
    return String(player && player._id ? player._id : player);
}
function makeDocument(data) {
    const doc = {
        ...clone(data),
        async save() {
            teams.set(String(this._id), {
                ...clone(this),
                players: this.players.map(normalizePlayerId),
                captain: normalizePlayerId(this.captain),
            });
        },
        async populate(paths) {
            const requested = Array.isArray(paths) ? paths.map(({ path: field }) => field) : [paths];
            if (requested.includes('players')) this.players = this.players.map((id) => players.get(normalizePlayerId(id))).filter(Boolean);
            if (requested.includes('captain')) this.captain = players.get(normalizePlayerId(this.captain)) || this.captain;
            return this;
        },
    };
    return doc;
}
function teamQuery(filter) {
    const query = {
        async populate(field) {
            const source = [...teams.values()].filter((team) => {
                if (filter?._id?.$ne && String(team._id) === String(filter._id.$ne)) return false;
                if (!filter?.players?.$in) return true;
                const requested = new Set(filter.players.$in.map(String));
                return team.players.some((playerId) => requested.has(String(playerId)));
            });
            return source.map((team) => {
                const doc = makeDocument(team);
                if (field === 'players') doc.players = doc.players.map((id) => players.get(normalizePlayerId(id))).filter(Boolean);
                return doc;
            });
        },
    };
    return query;
}

const Team = {
    find: teamQuery,
    async findById(id) {
        const team = teams.get(String(id));
        return team ? makeDocument(team) : null;
    },
    findByIdAndUpdate(id, update) {
        const query = {
            populate(field) {
                const team = teams.get(String(id));
                if (team) teams.set(String(id), { ...team, ...clone(update) });
                const result = team ? makeDocument(teams.get(String(id))) : null;
                query.then = (resolve) => {
                    if (result && field === 'players') result.players = result.players.map((playerId) => players.get(normalizePlayerId(playerId))).filter(Boolean);
                    resolve(result);
                };
                return query;
            },
        };
        return query;
    },
    async create(data) {
        const team = { _id: `team-${++nextTeamId}`, ...clone(data) };
        teams.set(team._id, team);
        return makeDocument(team);
    },
};

require.cache[teamPath] = { id: teamPath, filename: teamPath, loaded: true, exports: Team, children: [], paths: [] };
delete require.cache[controllerPath];
const controller = require(controllerPath);

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}
async function call(handler, params, body) {
    const res = response();
    await handler({ params, body, files: null }, res);
    return res;
}
function reset() {
    nextTeamId = 0;
    teams = new Map([
        ['source', { _id: 'source', name: 'Source Team', logo: '/source.png', players: ['p1', 'p2'], captain: 'p1' }],
        ['target', { _id: 'target', name: 'Target Team', logo: '/target.png', players: ['p3'], captain: 'p3' }],
    ]);
}

(async () => {
    reset();
    const unconfirmed = await call(controller.create, {}, { name: 'New Team', players: ['p1', 'p4'], captain: 'p1' });
    assert.strictEqual(unconfirmed.statusCode, 400, 'unconfirmed transfer should be rejected');
    assert.deepStrictEqual(teams.get('source').players, ['p1', 'p2'], 'rejected transfer must not alter source team');

    reset();
    const created = await call(controller.create, {}, {
        name: 'New Team', players: ['p1', 'p4'], captain: 'p1', transferPlayerIds: 'p1',
    });
    assert.strictEqual(created.statusCode, 201, `confirmed transfer should allow team creation: ${JSON.stringify(created.body)}`);
    assert.deepStrictEqual(teams.get('source').players, ['p2'], 'transferred player should be removed from source team');
    assert.strictEqual(teams.get('source').captain, 'p2', 'source captain should be reassigned when transferred');
    assert.ok(teams.get(created.body._id).players.includes('p1'), 'transferred player should be added to new team');

    reset();
    teams.get('source').players = ['p1'];
    const lastPlayer = await call(controller.create, {}, {
        name: 'New Team', players: ['p1'], captain: 'p1', transferPlayerIds: 'p1',
    });
    assert.strictEqual(lastPlayer.statusCode, 400, 'transfer must not leave the source team empty');
    assert.deepStrictEqual(teams.get('source').players, ['p1'], 'failed last-player transfer must leave source unchanged');

    reset();
    const updated = await call(controller.update, { id: 'target' }, {
        name: 'Target Team', players: ['p1', 'p3'], captain: 'p3', transferPlayerIds: 'p1',
    });
    assert.strictEqual(updated.statusCode, 200, 'confirmed transfer should allow editing a team');
    assert.deepStrictEqual(teams.get('source').players, ['p2'], 'edit should remove player from source team');
    assert.deepStrictEqual(teams.get('target').players, ['p1', 'p3'], 'edit should add player to target team');

    console.log('Team player transfer tests passed.');
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
