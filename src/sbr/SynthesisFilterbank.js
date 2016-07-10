import {TIME_SLOTS_RATE, WINDOW} from './constants';
import MDCT from '../mdct';

export default class SynthesisFilterbank {
  constructor() {
    this.V = new Float32Array(2 * 1280);
    this.mdctBuf = new Float32Array(2 * 64);
    this.mdct = new MDCT(128, 1 / 64);
  }

  // in: 64 x 32 complex, out: 2048 time samples
  process(inp[2][2][38][64], out, ch) {
    let v[2][1280] = this.V;
    let k, outOff = 0;
    let mdctBuf[2][64] = this.mdctBuf;

    // each loop creates 64 output samples
    for (let l = 0; l < TIME_SLOTS_RATE; l++) {
      // 1. shift buffer
      for (k = 1279; k >= 128; k--) {
        v[ch][k] = v[ch][k - 128];
      }
      
      // 2. negate odd imaginary values
      for (k = 1; k < 64; k += 2) {
        inp[ch][1][l][k] = -inp[ch][1][l][k];
      }

      // 3. compute IMDCT for real and imaginary parts
      this.mdct.half(inp[ch][0][l], 0, mdctBuf[0], 0);
      this.mdct.half(inp[ch][1][l], 0, mdctBuf[1], 0);

      // 4. combine IMDCT results
      for (k = 0; k < 64; k++) {
        v[ch][      k] = mdctBuf[1][k] - mdctBuf[0][63 - k];
        v[ch][127 - k] = mdctBuf[1][k] + mdctBuf[0][63 - k];
      }

      // 5. window and sum
      vector_fmul    (out, outOff, v[ch],    0, WINDOW,   0, 64);
      vector_fmul_add(out, outOff, v[ch],  192, WINDOW,  64, 64);
      vector_fmul_add(out, outOff, v[ch],  256, WINDOW, 128, 64);
      vector_fmul_add(out, outOff, v[ch],  448, WINDOW, 192, 64);
      vector_fmul_add(out, outOff, v[ch],  512, WINDOW, 256, 64);
      vector_fmul_add(out, outOff, v[ch],  704, WINDOW, 320, 64);
      vector_fmul_add(out, outOff, v[ch],  768, WINDOW, 384, 64);
      vector_fmul_add(out, outOff, v[ch],  960, WINDOW, 448, 64);
      vector_fmul_add(out, outOff, v[ch], 1024, WINDOW, 512, 64);
      vector_fmul_add(out, outOff, v[ch], 1216, WINDOW, 576, 64);
      outOff += 64;
    }
  }
}

// Performs dst = src0 * src1 for a vector of length len
function vector_fmul(dst, dstOff, src0, src0off, src1, src1off, len) {
  for (let i = 0; i < len; i++) {
    dst[dstOff++] = src0[src0off++] * src1[src1off++];
  }
}

// Performs dst += src0 * src1 for a vector of length len
function vector_fmul_add(dst, dstOff, src0, src0off, src1, src1off, len){
  for (let i = 0; i < len; i++) {
    dst[dstOff++] += src0[src0off++] * src1[src1off++];
  }
}
