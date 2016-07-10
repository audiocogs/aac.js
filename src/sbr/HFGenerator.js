import {RATE, T_HF_ADJ} from './constants';

const RELAX_COEF = 1.000001;
const ALPHA_MAX = 16;
const CHIRP_COEFS = [[0.75, 0.25], [0.90625, 0.09375]];
// values for bw [invfModePrev][invfMode]
const BW_COEFS = [
  [0.0, 0.6, 0.9, 0.98],
  [0.6, 0.75, 0.9, 0.98],
  [0.0, 0.75, 0.9, 0.98],
  [0.0, 0.75, 0.9, 0.98]
];
const CHIRP_MIN = 0.015625;

export default class HFGenerator {
  constructor() {
    this.alpha0 = new Float32Array(64 * 2);
    this.alpha1 = new Float32Array(64 * 2);
    this.alpha = new Float32Array(4);
    this.phi = new Float32Array(3 * 2 * 2);
  }
  
  // in: 32x40 complex Xlow, out: 32x40 complex Xhigh
  process(tables, cd, Xlow[32][40][2], Xhigh[64][40][2]) {
    // calculate chirp factors
    let bwArray = this.calculateChirpFactors(tables, cd);

    // calculate inverse filter coefficients for bands 0-k0
    let k0 = tables.k0;
    let alpha0[64][2] = this.alpha0;
    let alpha1[64][2] = this.alpha1;
    this.calculateIFCoefs(tables, alpha0, alpha1, Xlow);

    // HF generation
    let patchCount = tables.patchCount;
    let patchSubbands = tables.patchSubbands;
    let patchStartSubband = tables.patchStartSubband;
    let kx = tables.kx;
    let m = tables.m;
    let Nq = tables.nq;
    let fNoise = tables.fNoise;

    let te = cd.te;
    let start = RATE * te[0];
    let end = RATE * te[cd.envCount];

    let alpha = this.alpha;
    let square;
    let l, x; // loop indices
    let k = kx;
    let g = 0;

    for (let j = 0; j < patchCount; j++) {
      for (x = 0; x < patchSubbands[j]; x++, k++) {
        let p = patchStartSubband[j] + x;
        while (g <= Nq && k >= fNoise[g]) {
          g++;
        }
        g--;

        if (g < 0) {
          throw new Error("SBR: HFGenerator: no subband found for frequency " + k);
        }

        // fill Xhigh[k] (4.6.18.6.3)
        square = bwArray[g] * bwArray[g];
        alpha[0] = alpha1[p][0] * square;
        alpha[1] = alpha1[p][1] * square;
        alpha[2] = alpha0[p][0] * bwArray[g];
        alpha[3] = alpha0[p][1] * bwArray[g];
        for (l = start; l < end; l++) {
          let off = l + T_HF_ADJ;
          Xhigh[k][off][0] = alpha[0] * Xlow[p][off - 2][0]
            - alpha[1] * Xlow[p][off - 2][1]
            + alpha[2] * Xlow[p][off - 1][0]
            - alpha[3] * Xlow[p][off - 1][1]
            + Xlow[p][off][0];
            
          Xhigh[k][off][1] = alpha[0] * Xlow[p][off - 2][1]
            + alpha[1] * Xlow[p][off - 2][0]
            + alpha[2] * Xlow[p][off - 1][1]
            + alpha[3] * Xlow[p][off - 1][0]
            + Xlow[p][off][1];
        }
      }
    }

    // fill remaining with zero
    while (k < m + kx) {
      for (let j = 0; j < 40; j++) {
        Xhigh[k][j][0] = 0;
        Xhigh[k][j][1] = 0;
      }
      k++;
    }
  }

  calculateChirpFactors(tables, cd) {
    // calculates chirp factors and replaces old ones in ChannelData
    let nq = tables.nq;
    let invfMode = cd.invfMode;
    let invfModePrevious = cd.invfModePrevious;
    let bwArray = cd.bwArray;

    let tmp;
    let chirpCoefs;
    for (let i = 0; i < nq; i++) {
      tmp = BW_COEFS[invfModePrevious[i]][invfMode[i]];
      chirpCoefs = tmp < bwArray[i] ? CHIRP_COEFS[0] : CHIRP_COEFS[1];
      bwArray[i] = (chirpCoefs[0] * tmp) + (chirpCoefs[1] * bwArray[i]);
      if (bwArray[i] < CHIRP_MIN) {
        bwArray[i] = 0;
      }
    }

    return bwArray;
  }

  // calculates inverse filter coefficients for bands 0-k0 (4.6.18.6.2)
  calculateIFCoefs(tables, alpha0[64][2], alpha1[64][2], Xlow) {
    let k0 = tables.k0;
    let tmp0, tmp1;

    let phi[3][2][2] = this.phi;
    let d;
    for (let k = 0; k < k0; k++) {
      this.getCovarianceMatrix(Xlow, k, phi);

      // d(k)
      d = phi[2][1][0] * phi[1][0][0] - (phi[1][1][0] * phi[1][1][0] + phi[1][1][1] * phi[1][1][1]) / RELAX_COEF;

      // alpha1
      if (d === 0) {
        alpha1[k][0] = 0;
        alpha1[k][1] = 0;
      } else {
        tmp0 = phi[0][0][0] * phi[1][1][0] - phi[0][0][1] * phi[1][1][1] - phi[0][1][0] * phi[1][0][0];
        tmp1 = phi[0][0][0] * phi[1][1][1] + phi[0][0][1] * phi[1][1][0] - phi[0][1][1] * phi[1][0][0];
        alpha1[k][0] = tmp0 / d;
        alpha1[k][1] = tmp1 / d;
      }

      // alpha0
      if(phi[1][0][0] === 0) {
        alpha0[k][0] = 0;
        alpha0[k][1] = 0;
      } else {
        tmp0 = phi[0][0][0] + alpha1[k][0] * phi[1][1][0] + alpha1[k][1] * phi[1][1][1];
        tmp1 = phi[0][0][1] + alpha1[k][1] * phi[1][1][0] - alpha1[k][0] * phi[1][1][1];
        alpha0[k][0] = -tmp0 / phi[1][0][0];
        alpha0[k][1] = -tmp1 / phi[1][0][0];
      }

      if (alpha1[k][0] * alpha1[k][0] + alpha1[k][1] * alpha1[k][1] >= ALPHA_MAX
        || alpha0[k][0] * alpha0[k][0] + alpha0[k][1] * alpha0[k][1] >= ALPHA_MAX) {
        alpha1[k][0] = 0;
        alpha1[k][1] = 0;
        alpha0[k][0] = 0;
        alpha0[k][1] = 0;
      }
    }
  }

  // calculates covariance matrix (4.6.18.6.2)
  getCovarianceMatrix(x[32][40][2], k, phi[3][2][2]) {
    let real_sum2 = x[k][0][0] * x[k][2][0] + x[k][0][1] * x[k][2][1];
    let imag_sum2 = x[k][0][0] * x[k][2][1] - x[k][0][1] * x[k][2][0];
    let real_sum1 = 0.0, imag_sum1 = 0.0, real_sum0 = 0.0;
    
    for (let i = 1; i < 38; i++) {
      real_sum0 += x[k][i][0] * x[k][i    ][0] + x[k][i][1] * x[k][i    ][1];
      real_sum1 += x[k][i][0] * x[k][i + 1][0] + x[k][i][1] * x[k][i + 1][1];
      imag_sum1 += x[k][i][0] * x[k][i + 1][1] - x[k][i][1] * x[k][i + 1][0];
      real_sum2 += x[k][i][0] * x[k][i + 2][0] + x[k][i][1] * x[k][i + 2][1];
      imag_sum2 += x[k][i][0] * x[k][i + 2][1] - x[k][i][1] * x[k][i + 2][0];
    }
    
    phi[2 - 2][1][0] = real_sum2;
    phi[2 - 2][1][1] = imag_sum2;
    phi[2    ][1][0] = real_sum0 + x[k][ 0][0] * x[k][ 0][0] + x[k][ 0][1] * x[k][ 0][1];
    phi[1    ][0][0] = real_sum0 + x[k][38][0] * x[k][38][0] + x[k][38][1] * x[k][38][1];
    phi[2 - 1][1][0] = real_sum1 + x[k][ 0][0] * x[k][ 1][0] + x[k][ 0][1] * x[k][ 1][1];
    phi[2 - 1][1][1] = imag_sum1 + x[k][ 0][0] * x[k][ 1][1] - x[k][ 0][1] * x[k][ 1][0];
    phi[0    ][0][0] = real_sum1 + x[k][38][0] * x[k][39][0] + x[k][38][1] * x[k][39][1];
    phi[0    ][0][1] = imag_sum1 + x[k][38][0] * x[k][39][1] - x[k][38][1] * x[k][39][0];
  }
}
