import SBRHeader from './header';
import FrequencyTables from './FrequencyTables';
import ChannelData from './ChannelData';
import {makeArray} from './utils';
import AnalysisFilterbank from './AnalysisFilterbank';
import SynthesisFilterbank from './SynthesisFilterbank';
import HFGenerator from './HFGenerator';
import HFAdjuster from './HFAdjuster'

const NOISE_FLOOR_OFFSET = 6;
const EXTENSION_ID_PS = 2;

const T_HF_GEN = 8;
const T_HF_ADJ = 2;

const RATE = 2;
const TIME_SLOTS = 16; //TODO: 15 for 960-sample frames
const TIME_SLOTS_RATE = TIME_SLOTS * RATE;
const MAX_LTEMP = 6;

let pool = [];

class SBR {
  constructor(sampleRate, downSampled) {
    this.sampleRate = 2 * sampleRate;
    this.header = new SBRHeader;
    this.tables = new FrequencyTables;
    this.cd = [new ChannelData, new ChannelData];
    
    this.qmfA = new AnalysisFilterbank;
    this.qmfS = new SynthesisFilterbank;
    
    this.X = makeArray([2, 64, 38, 2]);
    this.Xlow = makeArray([32, 40, 2]);
    this.Xhigh = makeArray([64, 40, 2]);
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
    
    // if (this.header.decoded) {
    //       this.header.kxPrev = this.header.kx;
    //       this.header.mPrev = this.header.m;
    // }
    
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
      
        //       if (stream.read(1)) {
        // let count = stream.read(4);
        // if (count === 15) count += stream.read(8);
        // let bitsLeft = 8 * count;
        //
        // let extensionID;
        // while (bitsLeft>7) {
        //   bitsLeft -= 2;
        //   extensionID = stream.read(2);
        //   bitsLeft -= this.decodeExtension(stream, extensionID);
        // }
        //       }
    }
    
    stream.seek(end);
  }
  
  decodeChannelPair(stream) {
    if (stream.read(1)) {
      stream.advance(8); // reserved
    }
    
    let coupling = stream.read(1);
    
    if (coupling) {
      throw new Error('COUPLING')
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
      
      this.dequantSingle(0);
      this.dequantSingle(1);
    }
    
    this.cd[0].decodeSinusoidal(stream, this.header, this.tables);
    this.cd[1].decodeSinusoidal(stream, this.header, this.tables);
  }
  
  dequantSingle(ch) {
    // envelopes
    let a = this.cd[ch].ampRes;
    let eq = this.cd[ch].envelopeSFQ;
    let e = this.cd[ch].envelopeSF;
    let freqRes = this.cd[ch].freqRes;
    let n = this.tables.n;
    const EXP2 = [1, Math.SQRT2];

    for (let l = 0; l < this.cd[ch].envCount; l++) {
      for (let k = 0; k < n[freqRes[l]]; k++) {
        // e[l][k] = Math.pow(2.0, (e[l][k] >> a) + 6.0);
        if (a) {
          e[l][k] = Math.pow(2, eq[l][k] + 6);
        } else {
          e[l][k] = Math.pow(2, (eq[l][k] >> 1) + 6) * EXP2[eq[l][k] & 1];
        }
        
        if (e[l][k] > 1e20) {
          console.log("DEQUANT OUT OF BOUNDS");
          e[l][k] = 1;
        }
      }
    }

    // noise
    let nq = this.tables.nq;
    let lq = this.cd[ch].noiseCount;
    let qq = this.cd[ch].noiseFloorDataQ;
    let q = this.cd[ch].noiseFloorData;

    for (let l = 0; l < lq; l++) {
      for (let k = 0; k < nq; k++) {
        q[l][k] = Math.pow(2.0, NOISE_FLOOR_OFFSET - qq[l][k]);
      }
    }
  }
  
  decodeExtension(stream, extensionID) {
    switch (extensionID) {
      case EXTENSION_ID_PS:
        console.log("PS!")
        this.psUsed = true;
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

    this.qmfS.process(this.X[0], left, 0);
    if (this.stereo || this.psUsed) {
      this.qmfS.process(this.X[1], right, 1);
    }
    
    for (let i = 0; i < left.length; i++) {
      if (isNaN(left[i])) {
        console.log("NAN LEFT")
      }
    }
  }
  
  processChannel(ch, data) {
    // 2. analysis QMF (data -> W)
    this.qmfA.process(data, this.cd[ch].W[this.cd[ch].Ypos], ch);
    
    let kx = this.tables.kx;
    for (l = T_HF_GEN; l < TIME_SLOTS_RATE + T_HF_GEN; l++) {
      for (k = 0; k < kx; k++) {
        this.Xlow[k][l][0] = this.cd[ch].W[this.cd[ch].Ypos][l - T_HF_GEN][k][0];
        this.Xlow[k][l][1] = this.cd[ch].W[this.cd[ch].Ypos][l - T_HF_GEN][k][1];
      }

      for (k = kx; k < 32; k++) {
        this.Xlow[k][l][0] = 0;
        this.Xlow[k][l][1] = 0;
      }
    }
    
    // 1. old W -> Xlow (4.6.18.5)
    let kxPrev = this.tables.kxPrev;
    let l, k;
    for (l = 0; l < T_HF_GEN; l++) {
      for (k = 0; k < kxPrev; k++) {
        this.Xlow[k][l][0] = this.cd[ch].W[1 - this.cd[ch].Ypos][l + TIME_SLOTS_RATE - T_HF_GEN][k][0];
        this.Xlow[k][l][1] = this.cd[ch].W[1 - this.cd[ch].Ypos][l + TIME_SLOTS_RATE - T_HF_GEN][k][1];
      }
      
      for (k = kxPrev; k < 32; k++) {
        this.Xlow[k][l][0] = 0;
        this.Xlow[k][l][1] = 0;
      }
    }
    
    this.cd[ch].Ypos ^= 1;

    // 3. new W -> Xlow (4.6.18.5)
    // let kx = this.tables.kx;
    // for (l = T_HF_GEN; l < TIME_SLOTS_RATE + T_HF_GEN; l++) {
    //   for (k = 0; k < kx; k++) {
    //     this.Xlow[k][l][0] = this.cd[ch].W[l - T_HF_GEN][k][0];
    //     this.Xlow[k][l][1] = this.cd[ch].W[l - T_HF_GEN][k][1];
    //   }
    //
    //   for (k = kx; k < 32; k++) {
    //     this.Xlow[k][l][0] = 0;
    //     this.Xlow[k][l][1] = 0;
    //   }
    // }

    // 4. HF generation (Xlow -> Xhigh)
    HFGenerator(this.tables, this.cd[ch], this.Xlow, this.Xhigh);
    
    // 6. HF adjustment (Xhigh -> Y)
    HFAdjuster(this.header, this.tables, this.cd[ch], this.Xhigh, this.cd[ch].Y[this.cd[ch].Ypos]);

    // 5. old Y -> X
    let lTemp = this.cd[ch].lTemp;
    let mPrev = this.tables.mPrev;
    let m = this.tables.m;
    for (l = 0; l < lTemp; l++) {
      for (k = 0; k<kxPrev; k++) {
        this.X[ch][k][l][0] = this.Xlow[k][l + T_HF_ADJ][0];
        this.X[ch][k][l][1] = this.Xlow[k][l + T_HF_ADJ][1];
      }

      for (k = kxPrev; k < kxPrev + mPrev; k++) {
        this.X[ch][k][l][0] = this.cd[ch].Y[1 - this.cd[ch].Ypos][l + TIME_SLOTS_RATE][k][0];
        this.X[ch][k][l][1] = this.cd[ch].Y[1 - this.cd[ch].Ypos][l + TIME_SLOTS_RATE][k][1];
      }

      for (k = kxPrev + mPrev; k < 64; k++) {
        this.X[ch][k][l][0] = 0;
        this.X[ch][k][l][1] = 0;
      }
    }

    // 7. new Y -> X
    for (l = lTemp; l < TIME_SLOTS_RATE; l++) {
      for (k = 0; k < kx; k++) {
        this.X[ch][k][l][0] = this.Xlow[k][l + T_HF_ADJ][0];
        this.X[ch][k][l][1] = this.Xlow[k][l + T_HF_ADJ][1];
      }
      
      for (k = kx; k<kx+m; k++) {
        this.X[ch][k][l][0] = this.cd[ch].Y[this.cd[ch].Ypos][l][k][0];
        this.X[ch][k][l][1] = this.cd[ch].Y[this.cd[ch].Ypos][l][k][1];
      }
      
      for (k = kx + m; k < 64; k++) {
        this.X[ch][k][l][0] = 0;
        this.X[ch][k][l][1] = 0;
      }
    }

    // save data for next frame
    this.cd[ch].savePreviousData();
  }
}

module.exports = SBR;
