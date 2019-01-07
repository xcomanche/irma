/**
 * Supported commands:
 *   N                  - number - sets this number to d. number in range -CODE_CMD_OFFS...CODE_CMD_OFFS
 *   CODE_CMD_OFFS + 0  - step   - moves organism using current d direction
 *   CODE_CMD_OFFS + 1  - eat    - eats something using current d direction
 *   CODE_CMD_OFFS + 2  - clone  - clones himself using current d direction
 *   CODE_CMD_OFFS + 3  - see    - see using current d offset
 *   CODE_CMD_OFFS + 4  - dtoa   - copy value from d to a
 *   CODE_CMD_OFFS + 5  - dtob   - copy value from d to b
 *   CODE_CMD_OFFS + 6  - atod   - copy value from a to d
 *   CODE_CMD_OFFS + 7  - btod   - copy value from b to d
 *   CODE_CMD_OFFS + 8  - add    - d = a + b
 *   CODE_CMD_OFFS + 9  - sub    - d = a - b
 *   CODE_CMD_OFFS + 10 - mul    - d = a * b
 *   CODE_CMD_OFFS + 11 - div    - d = a / b
 *   CODE_CMD_OFFS + 12 - inc    - d++
 *   CODE_CMD_OFFS + 13 - dec    - d--
 *   CODE_CMD_OFFS + 14 - jump   - jump to d line
 *   CODE_CMD_OFFS + 15 - jumpg  - jump to d line if a > b
 *   CODE_CMD_OFFS + 16 - jumpl  - jump to d line if a <= b
 *   CODE_CMD_OFFS + 17 - jumpz  - jump to d line if a === 0
 *   CODE_CMD_OFFS + 18 - nop    - no operation
 *   CODE_CMD_OFFS + 19 - get    - a = mem[d]
 *   CODE_CMD_OFFS + 20 - put    - mem[d] = a
 *   CODE_CMD_OFFS + 21 - x      - d = org.x
 *   CODE_CMD_OFFS + 22 - y      - d = org.y
 *   CODE_CMD_OFFS + 23 - rand   - d = rand(-CODE_CMD_OFFS..CODE_CMD_OFFS)
 *
 * @author flatline
 */
const Config    = require('./../Config');
const FastArray = require('./../common/FastArray');
const Helper    = require('./../common/Helper');
const Organism  = require('./Organism');
const Mutations = require('./Mutations');
/**
 * {Number} This offset will be added to commands value. This is how we
 * add an ability to use numbers in a code, just putting them as command
 */
const CODE_CMD_OFFS = Config.CODE_CMD_OFFS;
/**
 * {Array} Array of increments. Using it we may obtain coordinates of the
 * point depending on one of 8 directions. We use these values in any command
 * related to sight, moving and so on
 */
const DIRX    = [0,  1,  1, 1, 0, -1, -1, -1];
const DIRY    = [-1, -1, 0, 1, 1,  1,  0, -1];
/**
 * {Number} World size. Pay attantion, that width and height is -1
 */
const WIDTH   = Config.WORLD_WIDTH - 1;
const HEIGHT  = Config.WORLD_HEIGHT - 1;
const WIDTH1  = WIDTH + 1;
const MAX     = Number.MAX_VALUE;

const ENERGY_MASK  = 0x40000000;
/**
 * {Number} Max amount of supported surfaces
 */
const SURFACES     = 16;

const ceil    = Math.ceil;
const round   = Math.round;
const rand    = Helper.rand;
const fin     = Number.isFinite;
const abs     = Math.abs;
const nan     = Number.isNaN;

class VM {
    constructor(world, surfaces) {
        this._world      = world;
        this._surfaces   = surfaces;
        this._SURFS      = surfaces.length;
        this._ENERGY     = surfaces[0];
        this._orgs       = null;
        this._iterations = 0;
        this._ts         = Date.now();

        this._createOrgs();
    }

    /**
     * Runs code of all organisms Config.iterationsPerRun time and return. Big
     * times value may slow down user and browser interaction
     */
    run() {
        const times      = Config.iterationsPerRun;
        const lines      = Config.linesPerIteration;
        const orgs       = this._orgs;
        const world      = this._world;
        const data       = world.data;
        let   ts         = Date.now();
        let   i          = 0;
        //
        // Loop X times through population
        //
        for (let time = 0; time < times; time++) {
            //
            // Loop through population
            //
            let orgsEnergy = 0;
            for (let o = 0, olen = orgs.size; o < olen; o++) {
                const org  = orgs.get(o);
                if (org === null) {continue}
                if (org.energy <= 0) {this._removeOrg(org); continue}

                const code = org.code;
                const len  = code.length;
                let   line = org.last;
                let   d    = org.d;
                let   a    = org.a;
                let   b    = org.b;
                //
                // Loop through few lines in one organism to
                // support pseudo multi threading
                //
                line = org.last;
                for (let l = 0; l < lines; l++) {
                    if (++line >= len) {line = 0}
                    //
                    // This is a number command: d = N
                    //
                    if (code[line] > -CODE_CMD_OFFS && code[line] < CODE_CMD_OFFS) {
                        d = code[line];
                        continue;
                    }
                    //
                    // This is ordinary command
                    //
                    switch (code[line]) {
                        case CODE_CMD_OFFS: { // step
                            const oldDot = org.dot;
                            let   inc;
                            if (oldDot !== 0) {
                                const surface = (oldDot & ENERGY_MASK) !== 0 ? this._ENERGY : this._surfaces[oldDot % SURFACES];
                                org.energy   -= surface.energy;
                                if (org.energy <= 0) {this._removeOrg(org); continue}
                                inc           = surface.step;
                            } else {
                                inc = 1;
                            }
                            const intd   = abs(d << 0) % 8;
                            const x      = org.x + DIRX[intd] * inc;
                            const y      = org.y + DIRY[intd] * inc;
                            if (x << 0 === org.x << 0 && y << 0 === org.y << 0) {
                                org.x = x;
                                org.y = y;
                                continue;
                            }
                            let   dot;
                            if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT || ((dot = data[x << 0][y << 0]) & 0x80000000) !== 0) {continue}

                            org.dot = dot;
                            world.moveOrg(org, x << 0, y << 0);
                            (oldDot & ENERGY_MASK) !== 0 ? world.energy(org.x << 0, org.y << 0, oldDot) : world.dot(org.x << 0, org.y << 0, oldDot);
                            org.x = x;
                            org.y = y;
                            break;
                        }

                        case CODE_CMD_OFFS + 1: { // eat
                            const intd = abs(d << 0) % 8;
                            const x    = (org.x + DIRX[intd]) << 0;
                            const y    = (org.y + DIRY[intd]) << 0;
                            if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) {continue}
                            const dot  = data[x][y];
                            if (dot === 0) {continue}                                    // no energy or out of the world
                            if ((dot & 0x80000000) !== 0) {                              // other organism
                                const nearOrg   = orgs.get(dot & 0x7fffffff);
                                const energy    = nearOrg.energy <= intd ? nearOrg.energy : intd;
                                nearOrg.energy -= energy;
                                org.energy     += energy;
                                if (nearOrg.energy <= 0) {this._removeOrg(nearOrg)}
                                continue;
                            }
                            if ((dot & ENERGY_MASK) !== 0) {
                                org.energy += Config.energyValue;                        // just energy block
                                world.empty(x, y, 0);
                                this._ENERGY.clear(dot & 0x3fffffff);
                            }
                            break
                        }

                        case CODE_CMD_OFFS + 2: { // clone
                            if (orgs.full || org.energy < Config.orgCloneEnergy) {continue}
                            const intd   = abs(d << 0) % 8;
                            const x      = (org.x + DIRX[intd]) << 0;
                            const y      = (org.y + DIRY[intd]) << 0;
                            if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT || data[x][y] !== 0) {continue}
                            const clone  = this._createOrg(x, y, org);
                            org.energy   = clone.energy = ceil(org.energy >> 1);
                            break;
                        }

                        case CODE_CMD_OFFS + 3: { // see d
                            const offs = (org.y << 0) * WIDTH1 + (org.x << 0) + (d << 0);
                            const x    = offs % WIDTH1;
                            const y    = offs / WIDTH1 << 0;
                            if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) {d = 0; continue}
                            const dot  = data[x][y];
                            if ((dot & 0x80000000) !== 0) {d = (orgs.get(dot & 0x7fffffff)).energy; continue}    // other organism
                            d = dot;                                                    // some world object
                            break;
                        }

                        case CODE_CMD_OFFS + 4:   // dtoa
                            a = d;
                            break;

                        case CODE_CMD_OFFS + 5:   // dtob
                            b = d;
                            break;

                        case CODE_CMD_OFFS + 6:   // atod
                            d = a;
                            break;

                        case CODE_CMD_OFFS + 7:   // abod
                            b = a;
                            break;

                        case CODE_CMD_OFFS + 8:   // add
                            d = a + b;
                            d = fin(d) ? d : MAX;
                            break;

                        case CODE_CMD_OFFS + 9:   // sub
                            d = a - b;
                            d = fin(d) ? d : -MAX;
                            break;

                        case CODE_CMD_OFFS + 10:  // mul
                            d = a * b;
                            d = fin(d) ? d : MAX;
                            break;

                        case CODE_CMD_OFFS + 11:  // div
                            d = a / b;
                            d = fin(d) ? d : 0;
                            d = !nan(d) ? d : 0;
                            break;

                        case CODE_CMD_OFFS + 12:  // inc
                            d++;
                            d = fin(d) ? d : MAX;
                            break;

                        case CODE_CMD_OFFS + 13:  // dec
                            d--;
                            d = fin(d) ? d : -MAX;
                            break;

                        case CODE_CMD_OFFS + 14: {// jump
                            const intd = abs(d << 0);
                            if (intd >= code.length) {continue}
                            line = intd;
                            break;
                        }

                        case CODE_CMD_OFFS + 15: {// jumpg
                            const intd = abs(d << 0);
                            if (intd >= code.length) {continue}
                            if (a > b) {
                                line = intd
                            }
                            break;
                        }

                        case CODE_CMD_OFFS + 16: {// jumpl
                            const intd = abs(d << 0);
                            if (intd >= code.length) {continue}
                            if (a <= b) {line = intd}
                            break;
                        }

                        case CODE_CMD_OFFS + 17:  // jumpz
                            const intd = abs(d << 0);
                            if (intd >= code.length) {continue}
                            if (a === 0) {line = intd}
                            break;

                        case CODE_CMD_OFFS + 18:  // nop
                            break;

                        case CODE_CMD_OFFS + 19: {// get
                            const intd = abs(d << 0);
                            if (intd >= org.mem.length) {continue}
                            a = org.mem[intd];
                            break;
                        }

                        case CODE_CMD_OFFS + 20: {// put
                            const intd = abs(d << 0);
                            if (intd >= org.mem.length) {continue}
                            org.mem[intd] = a;
                            break;
                        }

                        case CODE_CMD_OFFS + 21:  // x
                            d = org.x;
                            break;

                        case CODE_CMD_OFFS + 22:  // y
                            d = org.y;
                            break;

                        case CODE_CMD_OFFS + 23:  // rand
                            d = rand(CODE_CMD_OFFS * 2) - CODE_CMD_OFFS;
                            break;
                    }
                }
                org.last = line;
                org.d    = d;
                org.a    = a;
                org.b    = b;

                Mutations.update(org);
                if (org.age % Config.orgMaxAge === 0 && org.age > 0) {
                    this._removeOrg(org);
                }
                if (org.age % Config.orgEnergyPeriod === 0) {
                    org.energy--;//= (org.code.length || 1);
                }
                //
                // This mechanism runs surfaces moving (energy, lava, holes, water, sand)
                //
                if (o % Config.worldSurfacesDelay === 0) {
                    this._ENERGY.move(orgsEnergy);
                    for (let surf = 1; surf < this._SURFS; surf++) {this._surfaces[surf].move()}
                }

                org.age++;
                i += lines;
                orgsEnergy += org.energy;
            }
            //
            // This code moves surfaces (sand, water,...)
            //
            this._iterations++;
        }
        if (ts - this._ts > 1000) {
            world.title(`inps: ${round(((i / orgs.length) / ((Date.now() - ts) || 1)) * 1000)} orgs: ${orgs.length}`);
            this._ts = ts;

            if (orgs.length === 0) {this._createOrgs()}
        }
    }

    destroy() {
        this._orgs.destroy();
        this._orgs  = null;
        this._world = null;
        this._orgs  = null;
    }

    _removeOrg(org) {
        this._orgs.del(org.item);
        this._world.empty(org.x << 0, org.y << 0);
        this._world.dot(org.x << 0, org.y << 0, org.dot);
    }

    /**
     * Creates organisms population according to Config.orgAmount amount.
     * Organisms will be placed randomly in a world
     */
    _createOrgs() {
        const world     = this._world;
        const data      = world.data;
        const width     = Config.WORLD_WIDTH;
        const height    = Config.WORLD_HEIGHT;
        let   orgAmount = Config.orgAmount;

        this._orgs = new FastArray(orgAmount);
        while (orgAmount > 0) {
            const x = rand(width);
            const y = rand(height);
            if (data[x][y] === 0) {
                this._createOrg(x, y);
                orgAmount--;
            }
        }
    }

    /**
     * Creates one organism with default parameters and empty code
     * @param {Number} x X coordinate
     * @param {Number} y Y coordinate
     * @param {Organism=} parent Create from parent
     * @returns {Object} Item in FastArray class
     */
    _createOrg(x, y, parent = null) {
        const orgs = this._orgs;
        const org  = new Organism(Helper.id(), x, y, orgs.freeIndex, Config.orgEnergy, parent);

        orgs.add(org);
        this._world.org(x, y, org);

        return org;
    }
}

module.exports = VM;