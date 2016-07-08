import * as HuffmanTables from './HuffmanTables';
import {TIME_SLOTS, RATE, TIME_SLOTS_RATE, MAX_BANDS} from './constants';

const MAX_ENV_COUNT = 5;
const MAX_NQ = 5;
const MAX_NOISE_COUNT = 2;
const MAX_CHIRP_FACTORS = 5;

// frame classes
const FIXFIX = 0;
const FIXVAR = 1;
const VARFIX = 2;
const VARVAR = 3;

// CEIL_LOG[i] = Math.ceil(Math.log(i+1)/Math.log(2))
const CEIL_LOG2 = new Uint8Array([0, 1, 2, 2, 3, 3]);

export default class ChannelData {
  constructor() {
    this.freqRes = new Int32Array(MAX_ENV_COUNT);
    this.invfMode = new Int32Array(MAX_NQ);
    this.invfModePrevious = new Int32Array(MAX_NQ);

    this.dfEnv = new Uint8Array(MAX_ENV_COUNT);
    this.dfNoise = new Uint8Array(MAX_NOISE_COUNT);

    // previous is stored in envelopeSFQ[0]
    this.envelopeSFQ = new Uint8Array((MAX_ENV_COUNT + 1) * MAX_BANDS);
    this.envelopeSF = new Float32Array(MAX_ENV_COUNT * MAX_BANDS);
    this.te = new Uint8Array(MAX_ENV_COUNT + 1);
    this.tePrevious = 0;

    // previous is stored in noiseFloorDataQ[0]
    this.noiseFloorDataQ = new Uint8Array((MAX_NOISE_COUNT + 1) * MAX_BANDS);
    this.noiseFloorData = new Float32Array(MAX_NOISE_COUNT * MAX_BANDS);
    this.tq = new Uint8Array(MAX_NOISE_COUNT + 1);

    this.sinusoidals = new Uint8Array(MAX_BANDS);
    this.sIndexMappedPrevious = new Uint8Array(MAX_BANDS);

    this.bwArray = new Float32Array(MAX_CHIRP_FACTORS);

    this.lTemp = 0;
    this.gTmp = new Float32Array(42 * 48);
    this.qTmp = new Float32Array(42 * 48);
    
    // grid
    this.ampRes = 0;
    this.frameClass = 0;
    this.envCount = 0;
    this.envCountPrev = 0;
    this.noiseCount = 0;
    this.pointer = 0;
    this.la = 0;
    this.laPrevious = 0;
    
    this.noiseIndex = 0;
    this.sineIndex = 0;
  }
  
  decodeGrid(stream, header, tables) {
    // read bitstream and fill envelope borders
    let absBordTrail = TIME_SLOTS;
    let relLead, relTrail;

    this.ampRes = header.ampRes;

    switch (this.frameClass = stream.read(2)) {
      case FIXFIX:
        this.envCount = 1 << stream.read(2);
        relLead = this.envCount - 1;
        if (this.envCount === 1) this.ampRes = false;
        
        //check requirement (4.6.18.6.3):
        else if (this.envCount > 4) {
          throw new Error("SBR: too many envelopes: " + this.envCount);
        }

        this.freqRes.fill(stream.read(1));

        this.te[0] = 0;
        this.te[this.envCount] = absBordTrail;
        absBordTrail = (absBordTrail + (this.envCount >> 1)) / this.envCount;
        for (let i = 0; i < relLead; i++) {
          this.te[i + 1] = this.te[i] + absBordTrail;
        }

        break;
      case FIXVAR:
        absBordTrail += stream.read(2);
        relTrail = stream.read(2);
        this.envCount = relTrail + 1;

        this.te[0] = 0;
        this.te[this.envCount] = absBordTrail;
        for (let i = 0; i < relTrail; i++) {
          this.te[this.envCount - 1 - i] = this.te[this.envCount - i] - 2 * stream.read(2) - 2;
        }

        this.pointer = stream.read(CEIL_LOG2[this.envCount]);

        for (let i = 0; i < this.envCount; i++) {
          this.freqRes[this.envCount - 1 - i] = stream.read(1);
        }
        
        break;
      case VARFIX:
        this.te[0] = stream.read(2);
        relLead = stream.read(2);
        this.envCount = relLead + 1;

        this.te[this.envCount] = absBordTrail;
        for (let i = 0; i < relLead; i++) {
          this.te[i + 1] = this.te[i] + 2 * stream.read(2) + 2;
        }

        this.pointer = stream.read(CEIL_LOG2[this.envCount]);

        for (let i = 0; i < this.envCount; i++) {
          this.freqRes[i] = stream.read(1);
        }
        break;
      default: //VARVAR
        this.te[0] = stream.read(2);
        absBordTrail += stream.read(2);
        relLead = stream.read(2);
        relTrail = stream.read(2);
        this.envCount = relLead + relTrail + 1;
        if (this.envCount > 5) {
          throw new Error("SBR: too many envelopes: " + this.envCount);
        }

        this.te[this.envCount] = absBordTrail;
        for (let i = 0; i < relLead; i++) {
          this.te[i + 1] = this.te[i] + 2 * stream.read(2) + 2;
        }
        for (let i = 0; i < relTrail; i++) {
          this.te[this.envCount - 1 - i] = this.te[this.envCount - i] - 2 * stream.read(2) - 2;
        }

        this.pointer = stream.read(CEIL_LOG2[this.envCount]);

        for (let i = 0; i < this.envCount; i++) {
          this.freqRes[i] = stream.read(1);
        }
        break;
    }

    // fill noise floor time borders (4.6.18.3.3)
    this.noiseCount = this.envCount > 1 ? 2 : 1;
    this.tq[0] = this.te[0];
    this.tq[this.noiseCount] = this.te[this.envCount];
    if (this.envCount === 1) {
      this.tq[1] = this.te[1];
    } else {
      let middleBorder;
      switch (this.frameClass) {
        case FIXFIX:
          middleBorder = this.envCount >> 1;
          break;
        case VARFIX:
          if (this.pointer === 0) middleBorder = 1;
          else if (this.pointer === 1) middleBorder = this.envCount - 1;
          else middleBorder = this.pointer - 1;
          break;
        default:
          // if (this.pointer > 1) middleBorder = this.envCount + 1 - this.pointer;
          // else middleBorder = this.envCount - 1;
          middleBorder = this.envCount - Math.max(this.pointer - 1, 1);
          break;
      }

      this.tq[1] = this.te[middleBorder];
    }

    // calculate La (table 4.157)
    if ((this.frameClass === FIXVAR || this.frameClass === VARVAR) && this.pointer > 0) {
      this.la = this.envCount + 1 - this.pointer;
    } else if (this.frameClass === VARFIX && this.pointer > 1) {
      this.la = this.pointer - 1;
    } else {
      this.la = -1;
    }
  }
  
  decodeDTDF(stream) {
    for (let i = 0; i < this.envCount; i++) {
      this.dfEnv[i] = stream.read(1);
    }

    for (let i = 0; i < this.noiseCount; i++) {
      this.dfNoise[i] = stream.read(1);
    }
  }

  decodeInvf(stream, header, tables) {
    for (let i = 0; i < tables.nq; i++) {
      this.invfMode[i] = stream.read(2);
    }
  }
  
  decodeEnvelope(stream, header, tables, secCh, coupling) {
    // select huffman codebooks
    let tHuff, fHuff;
    let tLav, fLav;
    let delta, bits;
    if (coupling && secCh) {
      delta = 1;
      if (this.ampRes) {
        bits = 5;
        tHuff = HuffmanTables.T_HUFFMAN_ENV_BAL_3_0;
        tLav = HuffmanTables.T_HUFFMAN_ENV_BAL_3_0_LAV;
        fHuff = HuffmanTables.F_HUFFMAN_ENV_BAL_3_0;
        fLav = HuffmanTables.F_HUFFMAN_ENV_BAL_3_0_LAV;
      } else {
        bits = 6;
        tHuff = HuffmanTables.T_HUFFMAN_ENV_BAL_1_5;
        tLav = HuffmanTables.T_HUFFMAN_ENV_BAL_1_5_LAV;
        fHuff = HuffmanTables.F_HUFFMAN_ENV_BAL_1_5;
        fLav = HuffmanTables.F_HUFFMAN_ENV_BAL_1_5_LAV;
      }
    } else {
      delta = 0;
      if (this.ampRes) {
        bits = 6;
        tHuff = HuffmanTables.T_HUFFMAN_ENV_3_0;
        tLav = HuffmanTables.T_HUFFMAN_ENV_3_0_LAV;
        fHuff = HuffmanTables.F_HUFFMAN_ENV_3_0;
        fLav = HuffmanTables.F_HUFFMAN_ENV_3_0_LAV;
      } else {
        bits = 7;
        tHuff = HuffmanTables.T_HUFFMAN_ENV_1_5;
        tLav = HuffmanTables.T_HUFFMAN_ENV_1_5_LAV;
        fHuff = HuffmanTables.F_HUFFMAN_ENV_1_5;
        fLav = HuffmanTables.F_HUFFMAN_ENV_1_5_LAV;
      }
    }

    // read delta coded huffman data
    let envBands = tables.n;
    let odd = envBands[1] & 1;
    let envelopeSFQ[6][48] = this.envelopeSFQ;

    let j, k, frPrev;
    for (let i = 0; i < this.envCount; i++) {
      frPrev = i === 0 ? this.freqResPrevious : this.freqRes[i - 1];

      if (this.dfEnv[i]) {
        if (this.freqRes[i] === frPrev) {
          for (j = 0; j < envBands[this.freqRes[i]]; j++) {
            envelopeSFQ[i + 1][j] = envelopeSFQ[i][j] + ((this.decodeHuffman(stream, tHuff) - tLav) << delta);
            if (envelopeSFQ[i + 1][j] > 127) {
              console.log("OUT OF BOUNDS", envelopeSFQ[i + 1][j], i, envelopeSFQ[i][j], delta, tLav)
            }
          }
        } else if (this.freqRes[i] !== 0) {
          for (j = 0; j < envBands[this.freqRes[i]]; j++) {
            k = (j + odd) >> 1; //fLow[k] <= fHigh[j] < fLow[k + 1]
            envelopeSFQ[i + 1][j] = envelopeSFQ[i][k] + ((this.decodeHuffman(stream, tHuff) - tLav) << delta);
            if (envelopeSFQ[i + 1][j] > 127) {
              console.log("OUT OF BOUNDS 2", envelopeSFQ[i + 1][j], i, k, envelopeSFQ[i][k], delta, tLav)
            }
            
          }
        } else {
          for (j = 0; j < envBands[this.freqRes[i]]; j++) {
            k = j !== 0 ? (2 * j - odd) : 0; //fHigh[k] == fLow[j]
            envelopeSFQ[i + 1][j] = envelopeSFQ[i][k] + ((this.decodeHuffman(stream, tHuff) - tLav) << delta);
            if (envelopeSFQ[i + 1][j] > 127) {
              console.log("OUT OF BOUNDS 3", envelopeSFQ[i + 1][j], i, k, envelopeSFQ[i][k], delta, tLav)
            }
          }
        }
      } else {
        envelopeSFQ[i + 1][0] = stream.read(bits) << delta;
        if (envelopeSFQ[i + 1][0] > 127) {
          console.log("OUT OF BOUNDS 5", envelopeSFQ[i + 1][0], delta)
        }
        
        for (j = 1; j < envBands[this.freqRes[i]]; j++) {
          envelopeSFQ[i + 1][j] = envelopeSFQ[i + 1][j - 1] + ((this.decodeHuffman(stream, fHuff) - fLav) << delta);
          if (envelopeSFQ[i + 1][j] > 127) {
            console.log("OUT OF BOUNDS 4", envelopeSFQ[i + 1][j], envelopeSFQ[i + 1][j - 1], delta, tLav)
          }
        }
      }
    }

    // save for next frame
    envelopeSFQ[0].set(envelopeSFQ[this.envCount]);
  }
  
  decodeHuffman(stream, table) {
    let off = 0;
    let len = table[off][0];
    let cw = stream.read(len);
    let j;
    while (cw !== table[off][1]) {
      off++;
      j = table[off][0] - len;
      len = table[off][0];
      cw <<= j;
      cw |= stream.read(j);
    }
    return table[off][2];
  }
  
  decodeNoise(stream, header, tables, secCh, coupling) {
    // select huffman codebooks
    let tHuff, fHuff;
    let tLav, fLav;
    let delta;
    if (coupling && secCh) {
      delta = 1;
      tHuff = HuffmanTables.T_HUFFMAN_NOISE_BAL_3_0;
      tLav = HuffmanTables.T_HUFFMAN_NOISE_BAL_3_0_LAV;
      fHuff = HuffmanTables.F_HUFFMAN_NOISE_BAL_3_0;
      fLav = HuffmanTables.F_HUFFMAN_NOISE_BAL_3_0_LAV;
    } else {
      delta = 0;
      tHuff = HuffmanTables.T_HUFFMAN_NOISE_3_0;
      tLav = HuffmanTables.T_HUFFMAN_NOISE_3_0_LAV;
      fHuff = HuffmanTables.F_HUFFMAN_NOISE_3_0;
      fLav = HuffmanTables.F_HUFFMAN_NOISE_3_0_LAV;
    }

    // read huffman data: i=noise, j=band
    let noiseBands = tables.nq;
    let noiseFloorDataQ[3][64] = this.noiseFloorDataQ;

    let j;
    for (let i = 0; i < this.noiseCount; i++) {
      if (this.dfNoise[i]) {
        for (j = 0; j < noiseBands; j++) {
          noiseFloorDataQ[i + 1][j] = noiseFloorDataQ[i][j] + ((this.decodeHuffman(stream, tHuff) - tLav) << delta);
        }
      } else {
        noiseFloorDataQ[i + 1][0] = stream.read(5) << delta;
        for (j = 1; j < noiseBands; j++) {
          noiseFloorDataQ[i + 1][j] = noiseFloorDataQ[i + 1][j - 1] + ((this.decodeHuffman(stream, fHuff) - fLav) << delta);
        }
      }
    }

    //save for next frame
    noiseFloorDataQ[0].set(noiseFloorDataQ[this.noiseCount]);
  }
  
  decodeSinusoidal(stream, header, tables) {
    if (this.sinusoidalsPresent = stream.read(1)) {
      for (let i = 0; i < tables.n[1]; i++) {
        this.sinusoidals[i] = stream.read(1);
      }
    } else {
      this.sinusoidals.fill(0);
    }
  }
  
  copyGrid(cd) {
    this.ampRes = cd.ampRes;
    this.frameClass = cd.frameClass;
    this.envCount = cd.envCount;
    this.noiseCount = cd.noiseCount;

    this.freqRes.set(cd.freqRes);
    this.te.set(cd.te);
    this.tq.set(cd.tq);

    this.pointer = cd.pointer;
  }
  
  copyInvf(cd) {
    this.invfMode.set(cd.invfMode);
  }
  
  savePreviousData() {
    //lTemp for next frame
    this.lTemp = RATE * this.te[this.envCount] - TIME_SLOTS_RATE;

    //grid
    this.envCountPrev = this.envCount;
    this.freqResPrevious = this.freqRes[this.freqRes.length - 1];
    this.laPrevious = this.la;
    this.tePrevious = this.te[this.envCountPrev];
    
    //invf
    this.invfModePrevious.set(this.invfMode);
  }
}
