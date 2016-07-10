import tables from '../tables';
import {MAX_BANDS} from './constants';

const MAX_PATCHES = 6;
const LOG2 = Math.log(2);

const MFT_START_MIN = new Uint8Array([7, 7, 10, 11, 12, 16, 16, 17, 24]);
const MFT_STOP_MIN = new Uint8Array([13, 15, 20, 21, 23, 32, 32, 35, 48]);
const MFT_SF_OFFSETS = new Uint8Array([5, 5, 4, 4, 4, 3, 2, 1, 0]);
const MFT_START_OFFSETS = [
  new Int8Array([-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]), // 16000
  new Int8Array([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13]), // 22050
  new Int8Array([-5, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 16]), // 24000
  new Int8Array([-6, -4, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 16]), // 32000
  new Int8Array([-4, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 16, 20]), // 44100-64000
  new Int8Array([-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 16, 20, 24]) // >64000
];
const MFT_STOP_OFFSETS = [
  new Uint8Array([2, 4, 6, 8, 11, 14, 18, 22, 26, 31, 37, 44, 51]),
  new Uint8Array([2, 4, 6, 8, 11, 14, 18, 22, 26, 31, 36, 42, 49]),
  new Uint8Array([2, 4, 6, 9, 11, 14, 17, 21, 25, 29, 34, 39, 44]),
  new Uint8Array([2, 4, 6, 9, 11, 14, 17, 21, 24, 28, 33, 38, 43]),
  new Uint8Array([2, 4, 6, 9, 11, 14, 17, 20, 24, 28, 32, 36, 41]),
  new Uint8Array([2, 4, 6, 8, 10, 12, 14, 17, 20, 23, 26, 29, 32]),
  new Uint8Array([2, 4, 6, 8, 10, 12, 14, 17, 20, 23, 26, 29, 32]),
  new Uint8Array([2, 3, 5, 7, 9, 11, 13, 16, 18, 21, 23, 26, 29]),
  new Uint8Array([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16])
];
const MFT_INPUT1 = new Uint8Array([12, 10, 8]);
const MFT_INPUT2 = new Float32Array([1.0, 1.3]);
const LIM_BANDS_PER_OCTAVE_POW = new Float32Array([
  1.32715174233856803909, // 2^(0.49/1.2)
  1.18509277094158210129, // 2^(0.49/2)
  1.11987160404675912501 // 2^(0.49/3)
]);
const GOAL_SB_FACTOR = 2.048E6;

export default class FrequencyTables {
  constructor() {
    this.n = new Int32Array(2);
    this.fTable = new Array(2);
    this.patchSubbands = new Int32Array(MAX_PATCHES);
    this.patchStartSubband = new Int32Array(MAX_PATCHES);
    this.kx = 32;
    this.kxPrev = 0;
    this.m = 0;
    this.mPrev = 0;
    
    this.k0 = 0;
    this.k2 = 0;
    this.nMaster = 0;
    this.nq = 0;
    this.nl = 0;
    this.patchCount = 0;
  }
  
  calculate(header, sampleRate) {
    this.calculateMFT(header, sampleRate);
    this.calculateFrequencyTables(header);
    this.calculateNoiseTable(header);
    this.calculatePatches(sampleRate);
    this.calculateLimiterTable(header);
  }
  
  calculateMFT(header, sampleRate) {
    // lower border k0
    let sfIndex = tables.SAMPLE_INDEXES[sampleRate];
    let sfOff = MFT_SF_OFFSETS[sfIndex];
    this.k0 = MFT_START_MIN[sfIndex] + MFT_START_OFFSETS[sfOff][header.startFrequency];
    
    // higher border k2
    let stop = header.stopFrequency;
    let x;
    if (stop === 15) {
      x = 3 * this.k0;
    } else if (stop === 14) {
      x = 2 * this.k0
    } else {
      x = MFT_STOP_MIN[sfIndex] + MFT_STOP_OFFSETS[sfOff][header.stopFrequency - 1];
    }
    
    this.k2 = Math.min(MAX_BANDS, x);

    if (this.k0 >= this.k2) {
      throw new Error("SBR: MFT borders out of range: lower=" + this.k0 + ", higher=" + this.k2);
    }
    
    // check requirement (4.6.18.3.6):
    let max;
    if (sampleRate === 44100) {
      max = 35;
    } else if (sampleRate >= 48000) {
      max = 32;
    } else {
      max = 48;
    }
    
    if ((this.k2 - this.k0) > max) {
      throw new Error("SBR: too many subbands: "+ (this.k2 - this.k0) + ", maximum number for samplerate " + this.sampleRate + ": " + max);
    }

    // MFT calculation
    if (header.frequencyScale === 0) {
      // TODO
      this.calculateMFT1(header, this.k0, this.k2);
    } else {
      this.calculateMFT2(header, this.k0, this.k2);
    }

    // check requirement (4.6.18.3.6):
    if (header.xOverBand >= this.nMaster) {
      throw new Error("SBR: illegal length of master frequency table: " + this.nMaster + ", xOverBand: " + header.xOverBand);
    }
  }
  
  // MFT calculation if frequencyScale > 0
  calculateMFT2(header, k0, k2) {
    let bands = MFT_INPUT1[header.frequencyScale - 1];
    let warp = MFT_INPUT2[header.alterScale ? 1 : 0];

    let div1 = k2 / k0;
    let twoRegions;
    let k1;
    if (div1 > 2.2449) {
      twoRegions = true;
      k1 = 2 * k0;
    } else {
      twoRegions = false;
      k1 = k2;
    }

    let div2 = k1 / k0;
    let log = Math.log(div2) / (2 * LOG2);
    let bandCount0 = 2 * Math.round(bands * log);
    
    // check requirement (4.6.18.6.3):
    if (bandCount0 <= 0) {
      throw new Error("SBR: illegal band count for master frequency table: " + bandCount0);
    }

    let vDk0 = new Int32Array(bandCount0);
    let pow1, pow2;
    for (let i = 0; i < bandCount0; i++) {
      pow1 = Math.pow(div2, (i + 1) / bandCount0);
      pow2 = Math.pow(div2, i / bandCount0);
      vDk0[i] = Math.round(k0 * pow1) - Math.round(k0 * pow2);
      
      // check requirement (4.6.18.6.3):
      if (vDk0[i] <= 0) {
        throw new Error("SBR: illegal value in master frequency table: " + vDk0[i]);
      }
    }
    
    vDk0.sort();

    let vk0 = new Int32Array(bandCount0 + 1);
    vk0[0] = k0;
    for (let i = 1; i <= bandCount0; i++) {
      vk0[i] = vk0[i - 1] + vDk0[i - 1];
    }

    if (twoRegions) {
      div1 = k2 / k1;
      log = Math.log(div1);
      let bandCount1 = 2 * Math.round(bands * log / (2 * LOG2 * warp));
      let vDk1 = new Int32Array(bandCount1);
      let min = -1;
      for (let i = 0; i < bandCount1; i++) {
        pow1 = Math.pow(div1, (i + 1) / bandCount1);
        pow2 = Math.pow(div1, i / bandCount1);
        vDk1[i] = Math.round(k1 * pow1) - Math.round(k1 * pow2);
        if (min < 0 || vDk1[i] < min) {
          min = vDk1[i];
        }
      }

      if (min < vDk0[vDk0.length - 1]) {
        vDk1.sort();
        let change = vDk0[vDk0.length - 1] - vDk1[0];
        let x = vDk1[bandCount1 - 1] - vDk1[0] / 2.0;
        if (change > x) change = x;
        vDk1[0] += change;
        vDk1[bandCount1 - 1] -= change;
      }

      vDk1.sort();
      let vk1 = new Int32Array(bandCount1 + 1);
      vk1[0] = k1;
      for (let i = 1; i <= bandCount1; i++) {
        vk1[i] = vk1[i - 1] + vDk1[i - 1];
      }

      this.nMaster = bandCount0 + bandCount1;
      this.mft = new Int32Array(this.nMaster + 1);
      this.mft.set(vk0, 0);
      this.mft.set(vk1.subarray(1), bandCount0 + 1);
    } else {
      this.nMaster = bandCount0;
      this.mft = vk0;
    }
  }
  
  calculateFrequencyTables(header) {
    let xover = header.xOverBand;
    this.n[1] = this.nMaster - xover;
    this.n[0] = (this.n[1] + 1) >> 1;
    this.fTable[1] = new Int32Array(this.n[1] + 1);
    this.fTable[1].set(this.mft, xover);

    this.kxPrev = this.kx;
    this.kx = this.fTable[1][0];
    this.mPrev = this.m;
    this.m = this.fTable[1][this.n[1]] - this.kx;
    
    // check requirements (4.6.18.3.6):
    if (this.kx > 32) {
      throw new Error("SBR: start frequency border out of range: " + this.kx);
    }
    
    if ((this.kx + this.m) > 64) {
      throw new Error("SBR: stop frequency border out of range: " + (this.kx + this.m));
    }

    this.fTable[0] = new Int32Array(this.n[0] + 1);
    this.fTable[0][0] = this.fTable[1][0];
    let div = this.n[1] & 1;
    for (let i = 1; i <= this.n[0]; i++) {
      this.fTable[0][i] = this.fTable[1][2 * i - div];
    }
  }
  
  calculateNoiseTable(header) {
    let log = Math.log(this.k2 / this.kx) / LOG2;
    let x = Math.round(header.noiseBands * log);
    this.nq = Math.max(1, x);
    
    // check requirement (4.6.18.6.3):
    if (this.nq > 5) {
      throw new Error("SBR: too many noise floor scalefactors: " + this.nq);
    }

    this.fNoise = new Int32Array(this.nq + 1);
    this.fNoise[0] = this.fTable[0][0];
    let i = 0;
    for (let k = 1; k <= this.nq; k++) {
      i += ((this.n[0] - i) / (this.nq + 1 - k)) | 0;
      this.fNoise[k] = this.fTable[0][i];
    }
  }
  
  calculatePatches(sampleRate) {
    // patch construction (flowchart 4.46, p231)
    let msb = this.k0;
    let usb = this.kx;
    this.patchCount = 0;

    let goalSb = Math.round(GOAL_SB_FACTOR / sampleRate); // TODO: replace with table
    let k;
    if (goalSb < this.kx + this.m) {
      for (k = 0; this.mft[k] < goalSb; k++);
    } else {
      k = this.nMaster;
    }

    let sb, j, odd;
    do {
      j = k + 1;
      do {
        j--;
        sb = this.mft[j];
        odd = (sb - 2 + this.k0) & 1;
      } while(sb > (this.k0 - 1 + msb - odd));

      this.patchSubbands[this.patchCount] = Math.max(sb - usb, 0);
      this.patchStartSubband[this.patchCount] = this.k0 - odd - this.patchSubbands[this.patchCount];

      if (this.patchSubbands[this.patchCount] > 0) {
        usb = sb;
        msb = sb;
        this.patchCount++;
      } else {
        msb = this.kx;
      }

      if (this.mft[k] - sb < 3) {
        k = this.nMaster;
      }
    } while (sb !== (this.kx + this.m));

    if (this.patchSubbands[this.patchCount - 1] < 3 && this.patchCount > 1) {
      this.patchCount--;
    }

    // check requirement (4.6.18.6.3):
    if (this.patchCount > 5) {
      throw new Error("SBR: too many patches: " + this.patchCount);
    }
  }
  
  calculateLimiterTable(header) {
    // calculation of fTableLim (figure 4.40, p.213)
    let bands = header.limiterBands;
    if (bands == 0) {
      this.fLim = new Int32Array([this.fTable[0][0], this.fTable[0][this.n[0]]]);
      this.nl = 1;
      this.patchBorders = new Int32Array(0);
    } else {
      let limBandsPerOctaveWarped = LIM_BANDS_PER_OCTAVE_POW[bands - 1];

      this.patchBorders = new Int32Array(this.patchCount + 1);
      this.patchBorders[0] = this.kx;
      for (let i = 1; i <= this.patchCount; i++) {
        this.patchBorders[i] = this.patchBorders[i - 1] + this.patchSubbands[i - 1];
      }

      let limTable = new Int32Array(this.n[0] + this.patchCount);
      limTable.set(this.fTable[0].subarray(0, this.n[0] + 1));
      if (this.patchCount > 1) {
        limTable.set(this.patchBorders.subarray(1, this.patchCount), this.n[0] + 1);
      }
      
      limTable.sort();

      let inp = 1;
      let out = 0;
      let lims = this.n[0] + this.patchCount - 1;
      while (out < lims) {
        if (limTable[inp] >= limTable[out] * limBandsPerOctaveWarped) {
          limTable[++out] = limTable[inp++];
        } else if (limTable[inp] === limTable[out] || !this.patchBorders.includes(limTable[inp])) {
          inp++;
          lims--;
        } else if (!this.patchBorders.includes(limTable[out])) {
          limTable[out] = limTable[inp++];
          lims--;
        } else {
          limTable[++out] = limTable[inp++];
        }
      }

      this.fLim = limTable.subarray(0, lims + 1);
      this.nl = lims;
    }
  }
}
