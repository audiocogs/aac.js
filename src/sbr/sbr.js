import SBRHeader from './header';
import FrequencyTables from './FrequencyTables';
import ChannelData from './ChannelData';
import AnalysisFilterbank from './AnalysisFilterbank';
import SynthesisFilterbank from './SynthesisFilterbank';
import HFGenerator from './HFGenerator';
import HFAdjuster from './HFAdjuster';
import {T_HF_GEN, T_HF_ADJ, TIME_SLOTS_RATE} from './constants';

const NOISE_FLOOR_OFFSET = 6;
const EXTENSION_ID_PS = 2;
const EXP2 = [1, Math.SQRT2];

let pool = [];

class SBR {
  constructor(sampleRate, downSampled) {
    this.sampleRate = 2 * sampleRate;
    this.header = new SBRHeader;
    this.tables = new FrequencyTables;
    this.cd = [new ChannelData, new ChannelData];
    
    this.qmfA = new AnalysisFilterbank;
    this.qmfS = new SynthesisFilterbank;
    this.hfGen = new HFGenerator;
    this.hfAdj = new HFAdjuster;
    
    this.X = new Float32Array(2 * 2 * 38 * 64);
    this.Xlow = new Float32Array(32 * 40 * 2);
    this.Xhigh = new Float32Array(64 * 40 * 2);
    this.W = new Float32Array(2 * 32 * 32 * 2);
    this.Y = new Float32Array(2 * 38 * 64 * 2);
  }
  
  static get(sampleRate, downSampled) {
    let sbr = pool.length ? pool.pop() : new SBR(sampleRate, downSampled);
    sbr.sampleRate = 2 * sampleRate;
    return sbr;
  }
  
  static release(sbr) {
    pool.push(sbr);
  }
  
  decode(stream, count, stereo, crc) {
    this.stereo = stereo;
    var pos = stream.offset();
    var end = pos + count;
    
    if (crc) {
      stream.advance(10);
    }
    
    if (stream.read(1)) {
      // console.log("HEADER")
      this.header.decode(stream);
      if (this.header.reset) {
        this.tables.calculate(this.header, this.sampleRate);
      } else if (this.header.limiterBands !== this.header.limiterBandsPrev) {
        console.log("LIMITER BANDS CHANGED")
        this.tables.calculateLimiterTable(this.header);
      }
    }
        
    if (this.header.decoded) {
      // console.log('decode', stereo)
      if (stereo) {
        this.decodeChannelPair(stream);
      } else {
        this.decodeSingleChannel(stream);
      }
      
      if (stream.read(1)) {
        let count = stream.read(4);
        if (count === 15) count += stream.read(8);
        let bitsLeft = 8 * count;

        let extensionID;
        while (bitsLeft > 7) {
          bitsLeft -= 2;
          extensionID = stream.read(2);
          bitsLeft -= this.decodeExtension(stream, extensionID);
        }
      }
    }
    
    stream.seek(end);
  }
  
  decodeSingleChannel(stream) {
    if (stream.read(1)) {
      stream.advance(4); // reserved
    }
    
    this.cd[0].decodeGrid(stream, this.header, this.tables);
    this.cd[0].decodeDTDF(stream);
    this.cd[0].decodeInvf(stream, this.header, this.tables);
    this.cd[0].decodeEnvelope(stream, this.header, this.tables, false, false);
    this.cd[0].decodeNoise(stream, this.header, this.tables, false, false);
    this.cd[0].decodeSinusoidal(stream, this.header, this.tables);
    
    this.dequantSingle(this.cd[0]);
  }
  
  decodeChannelPair(stream) {
    if (stream.read(1)) {
      stream.advance(8); // reserved
    }
    
    let coupling = stream.read(1);
    
    if (coupling) {
      this.cd[0].decodeGrid(stream, this.header, this.tables);
      this.cd[1].copyGrid(this.cd[0]);
      this.cd[0].decodeDTDF(stream);
      this.cd[1].decodeDTDF(stream);
      this.cd[0].decodeInvf(stream, this.header, this.tables);
      this.cd[1].copyInvf(this.cd[0]);
      this.cd[0].decodeEnvelope(stream, this.header, this.tables, false, coupling);
      this.cd[0].decodeNoise(stream, this.header, this.tables, false, coupling);
      this.cd[1].decodeEnvelope(stream, this.header, this.tables, true, coupling);
      this.cd[1].decodeNoise(stream, this.header, this.tables, true, coupling);
      
      this.dequantCoupled();
    } else {
      this.cd[0].decodeGrid(stream, this.header, this.tables);
      this.cd[1].decodeGrid(stream, this.header, this.tables);
      this.cd[0].decodeDTDF(stream);
      this.cd[1].decodeDTDF(stream);
      this.cd[0].decodeInvf(stream, this.header, this.tables);
      this.cd[1].decodeInvf(stream, this.header, this.tables);
      this.cd[0].decodeEnvelope(stream, this.header, this.tables, false, coupling);
      this.cd[1].decodeEnvelope(stream, this.header, this.tables, true, coupling);
      this.cd[0].decodeNoise(stream, this.header, this.tables, false, coupling);
      this.cd[1].decodeNoise(stream, this.header, this.tables, true, coupling);
      
      this.dequantSingle(this.cd[0]);
      this.dequantSingle(this.cd[1]);
    }
    
    this.cd[0].decodeSinusoidal(stream, this.header, this.tables);
    this.cd[1].decodeSinusoidal(stream, this.header, this.tables);
  }
  
  dequantCoupled() {
    // envelopes
    let a = this.cd[0].ampRes;
    let panOffset = this.cd[0].ampRes ? 12 : 24;
    let e0q[6][48] = this.cd[0].envelopeSFQ;
    let e0[5][48] = this.cd[0].envelopeSF;
    let e1q[6][48] = this.cd[1].envelopeSFQ;
    let e1[5][48] = this.cd[1].envelopeSF;
    let r = this.cd[0].freqRes;
    let le = this.cd[0].envCount;
    let n = this.tables.n;

    let f1, f2, f3;
    for (let l = 0; l < le; l++) {
      for (let k = 0; k < n[r[l]]; k++) {
        if (a) {
          f1 = Math.pow(2, e0q[l + 1][k] + 7);
          f2 = Math.pow(2, panOffset - e1q[l + 1][k]);
        } else {
          f1 = Math.pow(2, (e0q[l + 1][k] >> 1) + 7) * EXP2[e0q[l + 1][k] & 1];
          f2 = Math.pow(2, (panOffset - e1q[l + 1][k]) >> 1) * EXP2[panOffset - e1q[l + 1][k] & 1];
        }
        
        if (f1 > 1e20) {
          console.log("DEQUANT OUT OF BOUNDS");
          f1 = 1;
        }
        
        f3 = f1 / (1.0 + f2);
        e0[l][k] = f3;
        e1[l][k] = f3 * f2;
      }
    }

    // noise
    let q0q[3][64] = this.cd[0].noiseFloorDataQ;
    let q0[2][64] = this.cd[0].noiseFloorData;
    let q1q[3][64] = this.cd[1].noiseFloorDataQ;
    let q1[2][64] = this.cd[1].noiseFloorData;
    let lq = this.cd[0].noiseCount;
    let nq = this.tables.nq;

    for (let l = 0; l < lq; l++) {
      for (let k = 0; k < nq; k++) {
        f1 = Math.pow(2, NOISE_FLOOR_OFFSET - q0q[l + 1][k] + 1);
        f2 = Math.pow(2, 12 - q1q[l + 1][k]);
        f3 = f1 / (1 + f2);
        q0[l][k] = f3;
        q1[l][k] = f3 * f2;
      }
    }
  }
  
  dequantSingle(cd) {
    // envelopes
    let a = cd.ampRes;
    let eq[6][48] = cd.envelopeSFQ;
    let e[5][48] = cd.envelopeSF;
    let freqRes = cd.freqRes;
    let n = this.tables.n;

    for (let l = 0; l < cd.envCount; l++) {
      for (let k = 0; k < n[freqRes[l]]; k++) {
        if (a) {
          e[l][k] = Math.pow(2, eq[l + 1][k] + 6);
        } else {
          e[l][k] = Math.pow(2, (eq[l + 1][k] >> 1) + 6) * EXP2[eq[l + 1][k] & 1];
        }
    
        if (e[l][k] > 1e20) {
          console.log("DEQUANT OUT OF BOUNDS");
          e[l][k] = 1;
        }
      }
    }

    // noise
    let nq = this.tables.nq;
    let lq = cd.noiseCount;
    let qq[3][64] = cd.noiseFloorDataQ;
    let q[2][64] = cd.noiseFloorData;

    for (let l = 0; l < lq; l++) {
      for (let k = 0; k < nq; k++) {
        q[l][k] = Math.pow(2, NOISE_FLOOR_OFFSET - qq[l + 1][k]);
      }
    }
  }
  
  decodeExtension(stream, extensionID) {
    switch (extensionID) {
      case EXTENSION_ID_PS:
        console.log("PS!")
        // this.psUsed = true;
        // if(ps==null) ps = new PS();
        // ps.decode(in);
        // if(!psUsed&&ps.hasHeader()) psUsed = true;
        break;
    }
  }
  
  // left/right: 1024 time samples
  process(left, right, downSampled) {
    if (!this.header.decoded) return;

    this.processChannel(0, left);
    if (this.stereo) {
      this.processChannel(1, right);
    } else if (this.psUsed) {
      throw new Error('PS data unsupported')
    }

    this.qmfS.process(this.X, left, 0);
    if (this.stereo || this.psUsed) {
      this.qmfS.process(this.X, right, 1);
    }
    //
    // for (let i = 0; i < left.length; i++) {
    //   if (isNaN(left[i])) {
    //     console.log("NAN LEFT")
    //   }
    // }
  }
  
  processChannel(ch, data) {
    let Xlow[32][40][2] = this.Xlow;
    let Xhigh[64][40][2] = this.Xhigh;
    let W[2][32][32][2] = this.W;
    let Y[2][38][64][2] = this.Y;
    let X[2][2][38][64] = this.X;
    
    // 1. old W -> Xlow (4.6.18.5)
    let kxPrev = this.tables.kxPrev;
    let l, k;
    for (l = 0; l < T_HF_GEN; l++) {
      for (k = 0; k < kxPrev; k++) {
        Xlow[k][l][0] = W[ch][l + TIME_SLOTS_RATE - T_HF_GEN][k][0];
        Xlow[k][l][1] = W[ch][l + TIME_SLOTS_RATE - T_HF_GEN][k][1];
      }
      
      for (k = kxPrev; k < 32; k++) {
        Xlow[k][l][0] = 0;
        Xlow[k][l][1] = 0;
      }
    }
    
    // 2. analysis QMF (data -> W)
    this.qmfA.process(data, W, ch);
    
    // 3. new W -> Xlow (4.6.18.5)
    let kx = this.tables.kx;
    for (l = T_HF_GEN; l < TIME_SLOTS_RATE + T_HF_GEN; l++) {
      for (k = 0; k < kx; k++) {
        Xlow[k][l][0] = W[ch][l - T_HF_GEN][k][0];
        Xlow[k][l][1] = W[ch][l - T_HF_GEN][k][1];
      }

      for (k = kx; k < 32; k++) {
        Xlow[k][l][0] = 0;
        Xlow[k][l][1] = 0;
      }
    }

    // 4. HF generation (Xlow -> Xhigh)
    this.hfGen.process(this.tables, this.cd[ch], Xlow, Xhigh);
    
    // 5. old Y -> X
    let lTemp = this.cd[ch].lTemp;
    let mPrev = this.tables.mPrev;
    let m = this.tables.m;
    for (l = 0; l < lTemp; l++) {
      for (k = 0; k<kxPrev; k++) {
        X[ch][0][l][k] = Xlow[k][l + T_HF_ADJ][0];
        X[ch][1][l][k] = Xlow[k][l + T_HF_ADJ][1];
      }

      for (k = kxPrev; k < kxPrev + mPrev; k++) {
        X[ch][0][l][k] = Y[ch][l + TIME_SLOTS_RATE][k][0];
        X[ch][1][l][k] = Y[ch][l + TIME_SLOTS_RATE][k][1];
        
      }

      for (k = kxPrev + mPrev; k < 64; k++) {
        X[ch][0][l][k] = 0;
        X[ch][1][l][k] = 0;
      }
    }
    
    // 6. HF adjustment (Xhigh -> Y)
    this.hfAdj.process(this.header, this.tables, this.cd[ch], Xhigh, Y, ch);

    // 7. new Y -> X
    for (l = lTemp; l < TIME_SLOTS_RATE; l++) {
      for (k = 0; k < kx; k++) {
        X[ch][0][l][k] = Xlow[k][l + T_HF_ADJ][0];
        X[ch][1][l][k] = Xlow[k][l + T_HF_ADJ][1];
      }
      
      for (k = kx; k<kx+m; k++) {
        X[ch][0][l][k] = Y[ch][l][k][0];
        X[ch][1][l][k] = Y[ch][l][k][1];
      }
      
      for (k = kx + m; k < 64; k++) {
        X[ch][0][l][k] = 0;
        X[ch][1][l][k] = 0;
      }
    }

    // save data for next frame
    this.cd[ch].savePreviousData();
  }
}

module.exports = SBR;
