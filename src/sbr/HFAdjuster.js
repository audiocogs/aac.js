import {HIGH, RATE, T_HF_ADJ} from './constants';
import {makeArray} from './utils';

const LIMITER_GAINS = [0.70795, 1.0, 1.41254, 10000000000];
const EPSILON = 1.0;
const EPSILON_0 = 1E-12;
const MAX_BOOST = 1.584893192;
const SMOOTHING_FACTORS = [
  0.33333333333333,
  0.30150283239582,
  0.21816949906249,
  0.11516383427084,
  0.03183050093751
];
const PHI = [
  [1, 0, -1, 0],
  [0, 1, 0, -1]
];
const MAX_GAIN = 100000;

// class Parameter {
//   //helper class containing arrays calculated by and passed to different methods
//   float[][] eMapped, qMapped;
//   boolean[][] sIndexMapped, sMapped;
//   float[][] Qm, Sm, Glim;
// }

export default function process(header, tables, cd, Xhigh, Y) {
  let p = map(tables, cd);
  let eCurr = estimateEnvelopes(header, tables, cd, Xhigh);
  calculateGain(header, tables, cd, p, eCurr);
  assembleSignals(header, tables, cd, p, Xhigh, Y);
}

// mapping of dequantized values (4.6.18.7.2)
function map(tables, cd) {
  // parameter from FrequencyTables
  let kx = tables.kx;
  let noiseTable = tables.fNoise;
  let fHigh = tables.fTable[HIGH];
  let nHigh = tables.n[HIGH];
  let M = tables.m;
  let nq = tables.nq;

  // parameter from ChannelData
  let le = cd.envCount;
  let lq = cd.noiseCount;
  let freqRes = cd.freqRes;
  let la = cd.la;

  //input and output arrays
  let eOrig = cd.envelopeSF;
  let eMapped = makeArray([7, 48]);
  let qOrig = cd.noiseFloorData;
  let qMapped = makeArray([7, 48]);
  let sinusoidals = cd.sinusoidals;
  let sIndexMappedPrev = cd.sIndexMappedPrevious;
  let sIndexMapped = makeArray([7, 48], Uint8Array);
  let sMapped = makeArray([7, 48], Uint8Array);

  // tmp integer
  let fr, maxI, k, i, m;
  let table;

  for (let e = 0; e < le; e++) {
    // envelopes: eOrig -> eMapped
    fr = freqRes[e];
    maxI = tables.n[fr];
    table = tables.fTable[fr];

    for (i = 0; i < maxI; i++) {
      for (m = table[i]; m < table[i + 1]; m++) {
        eMapped[e][m - kx] = eOrig[e][i];
      }
    }

    // noise: qOrig -> qMapped
    k = ((lq > 1) && (cd.te[e] >= cd.tq[1])) ? 1 : 0;
    for (i = 0; i < nq; i++) {
      for (m = noiseTable[i]; m < noiseTable[i + 1]; m++) {
        qMapped[e][m - kx] = qOrig[k][i];
      }
    }

    // sinusoidals: cd.sinusoidals -> sIndexMapped
    for (i = 0; i < nHigh; i++) {
      if (cd.sinusoidalsPresent) {
        m = (fHigh[i] + fHigh[i + 1]) >> 1;
        sIndexMapped[e][m - kx] = sinusoidals[i] && (e >= la || sIndexMappedPrev[m - kx]) ? 1 : 0;
      }
    }
    
    // sinusoidals: sIndexMapped -> sMapped
    let found;
    for (i = 0; i < maxI; i++) {
      found = 0;
      for (m = table[i]; m < table[i + 1]; m++) {
        if (sIndexMapped[e][m - kx]) {
          found = 1;
          break;
        }
      }
      
      for (m = table[i]; m < table[i + 1]; m++) {
        sMapped[e][m - kx] = found;
      }
    }
  }

  // fill with 0, because next frame may be larger than this one
  cd.sIndexMappedPrevious.fill(0);
  cd.sIndexMappedPrevious.set(sIndexMapped[le - 1]);

  return {eMapped, qMapped, sIndexMapped, sMapped};
}

// envelope estimation (4.6.18.7.3)
function estimateEnvelopes(header, tables, cd, Xhigh) {
  let te = cd.te;
  let M = tables.m;
  let kx = tables.kx;
  let le = cd.envCount;

  let eCurr = makeArray([7, 48]);

  let sum;
  let e, m, i, iLow, iHigh;
  if (header.interpolFrequency) {
    let div;

    for (e = 0; e < le; e++) {
      div = 0.5 / (te[e + 1] - te[e]);
      iLow = RATE * te[e] + T_HF_ADJ;
      iHigh = RATE * te[e + 1] + T_HF_ADJ;

      for (m = 0; m < M; m++) {
        sum = 0.0;

        //energy = sum over squares of absolute value
        for (i = iLow; i < iHigh; i++) {
          sum += Xhigh[m + kx][i][0] * Xhigh[m + kx][i][0] + Xhigh[m + kx][i][1] * Xhigh[m + kx][i][1];
        }
        
        eCurr[e][m] = sum * div;
      }
    }
  } else {
    let n = tables.n;
    let freqRes = cd.freqRes;

    let k;
    let table;
    let div1, div2;

    for (e = 0; e < le; e++) {
      div1 = RATE * (te[e + 1] - te[e]);
      iLow = RATE * te[e] + T_HF_ADJ;
      iHigh = RATE * te[e + 1] + T_HF_ADJ;
      table = tables.fTable[freqRes[e + 1]];

      for (m = 0; m < n[freqRes[e + 1]]; m++) {
        sum = 0.0;
        div2 = div1 * (table[m + 1] - table[m]);

        for (k = table[m]; k < table[m + 1]; k++) {
          for (i = iLow; i < iHigh; i++) {
            sum += Xhigh[k][i][0] * Xhigh[k][i][0] + Xhigh[k][i][1] * Xhigh[k][i][1];
          }
        }
        
        sum /= div2;
        
        for (k = table[m]; k < table[m + 1]; k++) {
          eCurr[e][k - kx] = sum;
        }
      }
    }
  }

  return eCurr;
}

//calculation of levels of additional HF signal components (4.6.18.7.4) and gain calculation (4.6.18.7.5)
function calculateGain(header, tables, cd, p, eCurr) {
  let limGain = header.limiterGains;
  let M = tables.m;
  let nl = tables.nl;
  let fLim = tables.fLim;
  let kx = tables.kx;

  let la = cd.la;
  let laPrevious = cd.laPrevious === cd.envCountPrev ? 0 : -1;
  let le = cd.envCount;

  // output arrays
  let Qm = makeArray([7, 48]);
  let Sm = makeArray([7, 48]);
  let gain = makeArray([7, 48]);

  let delta, delta2;
  let m, k, i;
  let km = new Int32Array(M);
  let eMappedSum = new Float32Array(nl);
  let tmp;
  let gTemp = makeArray([le, nl]);
  let gMax;

  // TODO: optimize this loops
  for (let e = 0; e < le; e++) {
    delta = !((e == la) || (e == laPrevious)) ? 1 : 0;
    
    for (k = 0; k < nl; k++) {
      let sum0, sum1;
      
      // level of additional HF components + gain
      for (m = fLim[k] - kx; m < fLim[k + 1] - kx; m++) {
        tmp = p.eMapped[e][m] / (1.0 + p.qMapped[e][m]);
        Qm[e][m] = Math.sqrt(tmp * p.qMapped[e][m]);
        Sm[e][m] = Math.sqrt(tmp * p.sIndexMapped[e][m]);

        if (p.sMapped[e][m] === 0) {
          gain[e][m] = Math.sqrt(p.eMapped[e][m] / ((1.0 + eCurr[e][m]) * (1.0 + p.qMapped[e][m] * delta)));
        } else {
          gain[e][m] = Math.sqrt(p.eMapped[e][m] * p.qMapped[e][m] / ((1.0 + eCurr[e][m]) * (1.0 + p.qMapped[e][m])));
        }
      }
      
      sum0 = sum1 = 0.0;
      for (m = fLim[k] - kx; m < fLim[k + 1] - kx; m++) {
        sum0 += p.eMapped[e][m];
        sum1 += eCurr[e][m];
      }
      
      gMax = LIMITER_GAINS[limGain] * Math.sqrt((EPSILON_0 + sum0) / (EPSILON_0 + sum1));
      gMax = Math.min(MAX_GAIN, gMax);
      // console.log(gMax, limGain, LIMITER_GAINS[limGain], EPSILON_0, sum0, sum1)
      
      for (m = fLim[k] - kx; m < fLim[k + 1] - kx; m++) {
        let qmMax = Qm[e][m] * gMax / gain[e][m];
        Qm[e][m] = Math.min(Qm[e][m], qmMax);
        gain[e][m] = Math.min(gain[e][m], gMax);
      }
      
      sum0 = sum1 = 0.0;
      for (m = fLim[k] - kx; m < fLim[k + 1] - kx; m++) {
        sum0 += p.eMapped[e][m];
        sum1 += eCurr[e][m] * gain[e][m] * gain[e][m]
              + Sm[e][m] * Sm[e][m]
              + ((delta && !Sm[e][m]) ? 1 : 0) * Qm[e][m] * Qm[e][m];
      }
      
      let gainBoost = Math.sqrt((EPSILON_0 + sum0) / (EPSILON_0 + sum1));
      gainBoost = Math.min(MAX_BOOST, gainBoost);
      for (m = fLim[k] - kx; m < fLim[k + 1] - kx; m++) {
        gain[e][m] *= gainBoost;
        Qm[e][m] *= gainBoost;
        Sm[e][m] *= gainBoost;
        // if (isNaN(gain[e][m])) {
          // console.log(gainBoost, sum0, sum1)
        // }
      }
    }
  }

  p.Qm = Qm;
  p.Sm = Sm;
  p.Glim = gain;
}

function checkNaN(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (isNaN(arr[i])) {
      console.log('NaN', i);
      break;
    }
  }
}

// assembling HF signals (4.6.18.7.5)
function assembleSignals(header, tables, cd, p, Xhigh, Y) {
  let reset = header.reset;
  let hSL = header.smoothingMode ? 0 : 4;
  let M = tables.m
  let le = cd.envCount;
  let lePrev = cd.envCountPrev;
  let te = cd.te;
  let la = cd.la;
  let laPrev = cd.laPrevious === cd.envCountPrev ? 0 : -1;
  let kx = tables.kx;
  let noiseIndex = reset ? 0 : cd.noiseIndex;
  let sineIndex = cd.sineIndex;

  let gTmp = cd.gTmp;
  let qTmp = cd.qTmp;

  let e, i, m, j;

  // save previous values
  if (reset) {
    for (i = 0; i < hSL; i++) {
      gTmp[i + 2 * te[0]].set(p.Glim[0].subarray(0, M));
      qTmp[i + 2 * te[0]].set(p.Qm[0].subarray(0, M));
    }
  } else if (hSL !== 0) {
    for (i = 0; i < 4; i++) {
      gTmp[i + 2 * te[0]].set(gTmp[i + 2 * cd.tePrevious]);
      qTmp[i + 2 * te[0]].set(qTmp[i + 2 * cd.tePrevious]);
    }
  }
  
  for (e = 0; e < le; e++) {
    for (i = 2 * te[e]; i < 2 * te[e + 1]; i++) {
      gTmp[hSL + i].set(p.Glim[e].subarray(0, M));
      qTmp[hSL + i].set(p.Qm[e].subarray(0, M));
    }
  }

  // calculate new
  let gFilt, qFilt;

  for (e = 0; e < le; e++) {
    for (i = RATE * te[e]; i < RATE * te[e + 1]; i++) {
      if (hSL !== 0 && e !== la && e != laPrev) {
        for (m = 0; m < M; m++) {
          let idx1 = i + hSL;
          gFilt = 0.0;
          for (j = 0; j <= hSL; j++) {
            gFilt += gTmp[idx1 - j][m] * SMOOTHING_FACTORS[j];
          }
          Y[i][m + kx][0] = Xhigh[m + kx][i + T_HF_ADJ][0] * gFilt;
          Y[i][m + kx][1] = Xhigh[m + kx][i + T_HF_ADJ][1] * gFilt;
        }
      } else {
        for (m = 0; m < M; m++) {
          gFilt = gTmp[i + hSL][m];
          Y[i][m + kx][0] = Xhigh[m + kx][i + T_HF_ADJ][0] * gFilt;
          Y[i][m + kx][1] = Xhigh[m + kx][i + T_HF_ADJ][1] * gFilt;
        }
      }

      if (e !== la && e !== laPrev) {
        let phiSign = (1 - 2 * (kx & 1));
        
        for (m = 0; m < M; m++) {
          if (p.Sm[e][m] !== 0) {
            Y[i][m + kx][0] += p.Sm[e][m] * PHI[0][sineIndex];
            Y[i][m + kx][1] += p.Sm[e][m] * (PHI[1][sineIndex] * phiSign);
          } else {
            if (hSL !== 0) {
              let idx1 = i + hSL;
              qFilt = 0.0;
              for (j = 0; j <= hSL; j++) {
                qFilt += qTmp[idx1 - j][m] * SMOOTHING_FACTORS[j];
              }
            } else {
              qFilt = qTmp[i][m];
            }
            Y[i][m + kx][0] += qFilt * NOISE_TABLE[noiseIndex][0];
            Y[i][m + kx][1] += qFilt * NOISE_TABLE[noiseIndex][1];
          }
          phiSign = -phiSign;
        }
      } else {
        let phiSign = (1 - 2 * (kx & 1));
        for (m = 0; m < M; m++) {
          Y[i][m + kx][0] += p.Sm[e][m] * PHI[0][sineIndex];
          Y[i][m + kx][1] += p.Sm[e][m] * (PHI[1][sineIndex] * phiSign);
          phiSign = -phiSign;
          
          if (isNaN(Y[i][m + kx][0]) || isNaN(Y[i][m + kx][1])) {
            console.log(p.Sm[e][m], PHI[0][sineIndex]);
          }
        }
      }
      
      noiseIndex = (noiseIndex + 1) & 0x1ff;
      sineIndex = (sineIndex + 1) & 3;
    }
  }

  cd.noiseIndex = noiseIndex;
  cd.sineIndex = sineIndex;
}

const NOISE_TABLE = [
  [-0.99948155879974, -0.59483414888382],
  [0.97113454341888, -0.67528516054153],
  [0.14130051434040, -0.95090985298157],
  [-0.47005495429039, -0.37340548634529],
  [0.80705064535141, 0.29653668403625],
  [-0.38981479406357, 0.89572608470917],
  [-0.01053049881011, -0.66959059238434],
  [-0.91266369819641, -0.11522938311100],
  [0.54840421676636, 0.75221365690231],
  [0.40009254217148, -0.98929399251938],
  [-0.99867975711823, -0.88147068023682],
  [-0.95531076192856, 0.90908759832382],
  [-0.45725932717323, -0.56716322898865],
  [-0.72929674386978, -0.98008275032043],
  [0.75622802972794, 0.20950329303741],
  [0.07069442421198, -0.78247898817062],
  [0.74496251344681, -0.91169005632401],
  [-0.96440184116364, -0.94739919900894],
  [0.30424630641937, -0.49438267946243],
  [0.66565030813217, 0.64652937650681],
  [0.91697007417679, 0.17514097690582],
  [-0.70774918794632, 0.52548652887344],
  [-0.70051413774490, -0.45340028405190],
  [-0.99496513605118, -0.90071910619736],
  [0.98164492845535, -0.77463155984879],
  [-0.54671579599380, -0.02570928446949],
  [-0.01689629070461, 0.00287506449968],
  [-0.86110347509384, 0.42548584938049],
  [-0.98892980813980, -0.87881129980087],
  [0.51756626367569, 0.66926783323288],
  [-0.99635028839111, -0.58107727766037],
  [-0.99969369173050, 0.98369991779327],
  [0.55266261100769, 0.59449058771133],
  [0.34581178426743, 0.94879418611526],
  [0.62664210796356, -0.74402970075607],
  [-0.77149701118469, -0.33883658051491],
  [-0.91592246294022, 0.03687901422381],
  [-0.76285493373871, -0.91371870040894],
  [0.79788339138031, -0.93180972337723],
  [0.54473078250885, -0.11919206380844],
  [-0.85639280080795, 0.42429855465889],
  [-0.92882400751114, 0.27871808409691],
  [-0.11708371341228, -0.99800843000412],
  [0.21356749534607, -0.90716296434402],
  [-0.76191693544388, 0.99768120050430],
  [0.98111045360565, -0.95854461193085],
  [-0.85913270711899, 0.95766568183899],
  [-0.93307244777679, 0.49431759119034],
  [0.30485755205154, -0.70540034770966],
  [0.85289651155472, 0.46766132116318],
  [0.91328084468842, -0.99839597940445],
  [-0.05890199914575, 0.70741826295853],
  [0.28398686647415, 0.34633556008339],
  [0.95258164405823, -0.54893416166306],
  [-0.78566324710846, -0.75568538904190],
  [-0.95789498090744, -0.20423194766045],
  [0.82411158084869, 0.96654617786407],
  [-0.65185445547104, -0.88734990358353],
  [-0.93643605709076, 0.99870789051056],
  [0.91427159309387, -0.98290503025055],
  [-0.70395684242249, 0.58796799182892],
  [0.00563771976158, 0.61768198013306],
  [0.89065051078796, 0.52783352136612],
  [-0.68683707714081, 0.80806946754456],
  [0.72165340185165, -0.69259858131409],
  [-0.62928247451782, 0.13627037405968],
  [0.29938435554504, -0.46051329374313],
  [-0.91781955957413, -0.74012714624405],
  [0.99298715591431, 0.40816611051559],
  [0.82368296384811, -0.74036049842834],
  [-0.98512834310532, -0.99972331523895],
  [-0.95915371179581, -0.99237799644470],
  [-0.21411126852036, -0.93424820899963],
  [-0.68821477890015, -0.26892307400703],
  [0.91851997375488, 0.09358228743076],
  [-0.96062767505646, 0.36099094152451],
  [0.51646184921265, -0.71373331546783],
  [0.61130720376968, 0.46950140595436],
  [0.47336128354073, -0.27333179116249],
  [0.90998309850693, 0.96715664863586],
  [0.44844800233841, 0.99211573600769],
  [0.66614890098572, 0.96590173244476],
  [0.74922239780426, -0.89879858493805],
  [-0.99571585655212, 0.52785521745682],
  [0.97401082515717, -0.16855870187283],
  [0.72683745622635, -0.48060774803162],
  [0.95432192087173, 0.68849605321884],
  [-0.72962206602097, -0.76608443260193],
  [-0.85359477996826, 0.88738125562668],
  [-0.81412428617477, -0.97480767965317],
  [-0.87930774688721, 0.74748307466507],
  [-0.71573328971863, -0.98570609092712],
  [0.83524298667908, 0.83702534437180],
  [-0.48086065053940, -0.98848503828049],
  [0.97139126062393, 0.80093622207642],
  [0.51992827653885, 0.80247628688812],
  [-0.00848591234535, -0.76670128107071],
  [-0.70294374227524, 0.55359911918640],
  [-0.95894426107407, -0.43265503644943],
  [0.97079253196716, 0.09325857460499],
  [-0.92404294013977, 0.85507702827454],
  [-0.69506472349167, 0.98633414506912],
  [0.26559203863144, 0.73314309120178],
  [0.28038442134857, 0.14537914097309],
  [-0.74138122797012, 0.99310338497162],
  [-0.01752796024084, -0.82616633176804],
  [-0.55126774311066, -0.98898541927338],
  [0.97960901260376, -0.94021445512772],
  [-0.99196308851242, 0.67019015550613],
  [-0.67684930562973, 0.12631492316723],
  [0.09140039235353, -0.20537731051445],
  [-0.71658962965012, -0.97788202762604],
  [0.81014639139175, 0.53722649812698],
  [0.40616992115974, -0.26469007134438],
  [-0.67680186033249, 0.94502049684525],
  [0.86849772930145, -0.18333598971367],
  [-0.99500381946564, -0.02634122036397],
  [0.84329187870026, 0.10406957566738],
  [-0.09215968847275, 0.69540011882782],
  [0.99956172704697, -0.12358541786671],
  [-0.79732781648636, -0.91582524776459],
  [0.96349972486496, 0.96640455722809],
  [-0.79942780733109, 0.64323902130127],
  [-0.11566039919853, 0.28587844967842],
  [-0.39922955632210, 0.94129604101181],
  [0.99089199304581, -0.92062628269196],
  [0.28631284832954, -0.91035044193268],
  [-0.83302724361420, -0.67330408096313],
  [0.95404446125031, 0.49162766337395],
  [-0.06449863314629, 0.03250560909510],
  [-0.99575054645538, 0.42389783263206],
  [-0.65501141548157, 0.82546114921570],
  [-0.81254440546036, -0.51627236604691],
  [-0.99646371603012, 0.84490531682968],
  [0.00287840608507, 0.64768260717392],
  [0.70176988840103, -0.20453028380871],
  [0.96361881494522, 0.40706968307495],
  [-0.68883758783340, 0.91338956356049],
  [-0.34875586628914, 0.71472293138504],
  [0.91980081796646, 0.66507452726364],
  [-0.99009048938751, 0.85868018865585],
  [0.68865793943405, 0.55660319328308],
  [-0.99484401941299, -0.20052559673786],
  [0.94214510917664, -0.99696427583694],
  [-0.67414629459381, 0.49548220634460],
  [-0.47339352965355, -0.85904330015182],
  [0.14323651790619, -0.94145596027374],
  [-0.29268294572830, 0.05759225040674],
  [0.43793860077858, -0.78904968500137],
  [-0.36345127224922, 0.64874434471130],
  [-0.08750604838133, 0.97686946392059],
  [-0.96495270729065, -0.53960305452347],
  [0.55526942014694, 0.78891521692276],
  [0.73538213968277, 0.96452075242996],
  [-0.30889773368835, -0.80664390325546],
  [0.03574995696545, -0.97325617074966],
  [0.98720687627792, 0.48409134149551],
  [-0.81689298152924, -0.90827703475952],
  [0.67866861820221, 0.81284505128860],
  [-0.15808570384979, 0.85279554128647],
  [0.80723392963409, -0.24717418849468],
  [0.47788757085800, -0.46333149075508],
  [0.96367555856705, 0.38486748933792],
  [-0.99143874645233, -0.24945276975632],
  [0.83081877231598, -0.94780850410461],
  [-0.58753192424774, 0.01290772389621],
  [0.95538109540939, -0.85557049512863],
  [-0.96490919589996, -0.64020973443985],
  [-0.97327101230621, 0.12378127872944],
  [0.91400367021561, 0.57972472906113],
  [-0.99925839900970, 0.71084845066071],
  [-0.86875903606415, -0.20291699469090],
  [-0.26240035891533, -0.68264555931091],
  [-0.24664412438869, -0.87642270326614],
  [0.02416275814176, 0.27192914485931],
  [0.82068622112274, -0.85087788105011],
  [0.88547372817993, -0.89636802673340],
  [-0.18173077702522, -0.26152145862579],
  [0.09355476498604, 0.54845124483109],
  [-0.54668414592743, 0.95980775356293],
  [0.37050989270210, -0.59910142421722],
  [-0.70373594760895, 0.91227668523788],
  [-0.34600785374641, -0.99441426992416],
  [-0.68774479627609, -0.30238837003708],
  [-0.26843291521072, 0.83115667104721],
  [0.49072334170341, -0.45359709858894],
  [0.38975992798805, 0.95515358448029],
  [-0.97757124900818, 0.05305894464254],
  [-0.17325553297997, -0.92770671844482],
  [0.99948036670685, 0.58285546302795],
  [-0.64946246147156, 0.68645507097244],
  [-0.12016920745373, -0.57147324085236],
  [-0.58947455883026, -0.34847131371498],
  [-0.41815140843391, 0.16276422142982],
  [0.99885648488998, 0.11136095225811],
  [-0.56649613380432, -0.90494865179062],
  [0.94138020277023, 0.35281917452812],
  [-0.75725078582764, 0.53650552034378],
  [0.20541973412037, -0.94435143470764],
  [0.99980372190475, 0.79835915565491],
  [0.29078277945518, 0.35393777489662],
  [-0.62858772277832, 0.38765692710876],
  [0.43440905213356, -0.98546332120895],
  [-0.98298585414886, 0.21021524071693],
  [0.19513028860092, -0.94239830970764],
  [-0.95476663112640, 0.98364555835724],
  [0.93379634618759, -0.70881992578506],
  [-0.85235410928726, -0.08342348039150],
  [-0.86425095796585, -0.45795026421547],
  [0.38879778981209, 0.97274428606033],
  [0.92045122385025, -0.62433654069901],
  [0.89162534475327, 0.54950958490372],
  [-0.36834338307381, 0.96458297967911],
  [0.93891763687134, -0.89968353509903],
  [0.99267655611038, -0.03757034242153],
  [-0.94063472747803, 0.41332337260246],
  [0.99740225076675, -0.16830494999886],
  [-0.35899412631989, -0.46633225679398],
  [0.05237237364054, -0.25640362501144],
  [0.36703583598137, -0.38653266429901],
  [0.91653180122375, -0.30587628483772],
  [0.69000804424286, 0.90952169895172],
  [-0.38658750057220, 0.99501574039459],
  [-0.29250815510750, 0.37444993853569],
  [-0.60182201862335, 0.86779648065567],
  [-0.97418588399887, 0.96468526124954],
  [0.88461571931839, 0.57508403062820],
  [0.05198933184147, 0.21269661188126],
  [-0.53499621152878, 0.97241556644440],
  [-0.49429559707642, 0.98183864355087],
  [-0.98935145139694, -0.40249159932137],
  [-0.98081380128860, -0.72856897115707],
  [-0.27338150143623, 0.99950921535492],
  [0.06310802698135, -0.54539585113525],
  [-0.20461677014828, -0.14209978282452],
  [0.66223841905594, 0.72528582811356],
  [-0.84764343500137, 0.02372316829860],
  [-0.89039862155914, 0.88866579532623],
  [0.95903307199478, 0.76744925975800],
  [0.73504126071930, -0.03747203201056],
  [-0.31744435429573, -0.36834111809731],
  [-0.34110826253891, 0.40211221575737],
  [0.47803884744644, -0.39423218369484],
  [0.98299193382263, 0.01989791356027],
  [-0.30963072180748, -0.18076720833778],
  [0.99992591142654, -0.26281872391701],
  [-0.93149733543396, -0.98313164710999],
  [0.99923473596573, -0.80142992734909],
  [-0.26024168729782, -0.75999760627747],
  [-0.35712513327599, 0.19298963248730],
  [-0.99899083375931, 0.74645155668259],
  [0.86557173728943, 0.55593866109848],
  [0.33408042788506, 0.86185956001282],
  [0.99010735750198, 0.04602397605777],
  [-0.66694271564484, -0.91643613576889],
  [0.64016789197922, 0.15649530291557],
  [0.99570536613464, 0.45844584703445],
  [-0.63431465625763, 0.21079117059708],
  [-0.07706847041845, -0.89581435918808],
  [0.98590087890625, 0.88241720199585],
  [0.80099332332611, -0.36851897835732],
  [0.78368133306503, 0.45506998896599],
  [0.08707806468010, 0.80938994884491],
  [-0.86811882257462, 0.39347308874130],
  [-0.39466530084610, -0.66809433698654],
  [0.97875326871872, -0.72467839717865],
  [-0.95038563013077, 0.89563220739365],
  [0.17005239427090, 0.54683053493500],
  [-0.76910793781281, -0.96226614713669],
  [0.99743282794952, 0.42697158455849],
  [0.95437383651733, 0.97002321481705],
  [0.99578905105591, -0.54106825590134],
  [0.28058260679245, -0.85361421108246],
  [0.85256522893906, -0.64567607641220],
  [-0.50608539581299, -0.65846014022827],
  [-0.97210735082626, -0.23095212876797],
  [0.95424050092697, -0.99240148067474],
  [-0.96926569938660, 0.73775655031204],
  [0.30872163176537, 0.41514959931374],
  [-0.24523839354515, 0.63206630945206],
  [-0.33813264966011, -0.38661777973175],
  [-0.05826828256249, -0.06940773874521],
  [-0.22898460924625, 0.97054851055145],
  [-0.18509915471077, 0.47565764188766],
  [-0.10488238185644, -0.87769949436188],
  [-0.71886587142944, 0.78030979633331],
  [0.99793875217438, 0.90041309595108],
  [0.57563304901123, -0.91034334897995],
  [0.28909647464752, 0.96307784318924],
  [0.42188999056816, 0.48148649930954],
  [0.93335050344467, -0.43537023663521],
  [-0.97087377309799, 0.86636447906494],
  [0.36722871661186, 0.65291655063629],
  [-0.81093025207520, 0.08778370171785],
  [-0.26240602135658, -0.92774093151093],
  [0.83996498584747, 0.55839848518372],
  [-0.99909615516663, -0.96024608612061],
  [0.74649465084076, 0.12144893407822],
  [-0.74774593114853, -0.26898062229156],
  [0.95781666040421, -0.79047924280167],
  [0.95472306013107, -0.08588775992393],
  [0.48708331584930, 0.99999040365219],
  [0.46332037448883, 0.10964126139879],
  [-0.76497006416321, 0.89210927486420],
  [0.57397389411926, 0.35289704799652],
  [0.75374317169189, 0.96705216169357],
  [-0.59174400568008, -0.89405369758606],
  [0.75087904930115, -0.29612672328949],
  [-0.98607856035233, 0.25034910440445],
  [-0.40761056542397, -0.90045571327209],
  [0.66929268836975, 0.98629492521286],
  [-0.97463697195053, -0.00190223299433],
  [0.90145510435104, 0.99781388044357],
  [-0.87259286642075, 0.99233585596085],
  [-0.91529458761215, -0.15698707103729],
  [-0.03305738791823, -0.37205263972282],
  [0.07223051041365, -0.88805001974106],
  [0.99498009681702, 0.97094357013702],
  [-0.74904936552048, 0.99985486268997],
  [0.04585228487849, 0.99812334775925],
  [-0.89054954051971, -0.31791913509369],
  [-0.83782142400742, 0.97637635469437],
  [0.33454805612564, -0.86231517791748],
  [-0.99707579612732, 0.93237990140915],
  [-0.22827528417110, 0.18874759972095],
  [0.67248046398163, -0.03646211326122],
  [-0.05146538093686, -0.92599701881409],
  [0.99947297573090, 0.93625229597092],
  [0.66951125860214, 0.98905825614929],
  [-0.99602955579758, -0.44654715061188],
  [0.82104903459549, 0.99540740251541],
  [0.99186509847641, 0.72022998332977],
  [-0.65284591913223, 0.52186721563339],
  [0.93885445594788, -0.74895310401917],
  [0.96735250949860, 0.90891814231873],
  [-0.22225968539715, 0.57124030590057],
  [-0.44132784008980, -0.92688840627670],
  [-0.85694974660873, 0.88844531774521],
  [0.91783040761948, -0.46356892585754],
  [0.72556972503662, -0.99899554252625],
  [-0.99711579084396, 0.58211559057236],
  [0.77638977766037, 0.94321835041046],
  [0.07717324048281, 0.58638399839401],
  [-0.56049829721451, 0.82522302865982],
  [0.98398894071579, 0.39467439055443],
  [0.47546947002411, 0.68613046407700],
  [0.65675091743469, 0.18331636488438],
  [0.03273375332355, -0.74933111667633],
  [-0.38684144616127, 0.51337349414825],
  [-0.97346270084381, -0.96549361944199],
  [-0.53282153606415, -0.91423267126083],
  [0.99817311763763, 0.61133575439453],
  [-0.50254499912262, -0.88829338550568],
  [0.01995873264968, 0.85223513841629],
  [0.99930381774902, 0.94578897953033],
  [0.82907766103745, -0.06323442608118],
  [-0.58660709857941, 0.96840775012970],
  [-0.17573736608028, -0.48166921734810],
  [0.83434289693832, -0.13023450970650],
  [0.05946491286159, 0.20511047542095],
  [0.81505483388901, -0.94685947895050],
  [-0.44976380467415, 0.40894573926926],
  [-0.89746475219727, 0.99846577644348],
  [0.39677256345749, -0.74854665994644],
  [-0.07588948309422, 0.74096214771271],
  [0.76343196630478, 0.41746628284454],
  [-0.74490106105804, 0.94725912809372],
  [0.64880120754242, 0.41336661577225],
  [0.62319535017014, -0.93098312616348],
  [0.42215818166733, -0.07712787389755],
  [0.02704554051161, -0.05417517945170],
  [0.80001771450043, 0.91542196273804],
  [-0.79351830482483, -0.36208897829056],
  [0.63872361183167, 0.08128252625465],
  [0.52890521287918, 0.60048872232437],
  [0.74238550662994, 0.04491915181279],
  [0.99096131324768, -0.19451183080673],
  [-0.80412328243256, -0.88513815402985],
  [-0.64612615108490, 0.72198677062988],
  [0.11657770723104, -0.83662831783295],
  [-0.95053184032440, -0.96939903497696],
  [-0.62228870391846, 0.82767260074615],
  [0.03004475869238, -0.99738895893097],
  [-0.97987216711044, 0.36526128649712],
  [-0.99986982345581, -0.36021611094475],
  [0.89110648632050, -0.97894251346588],
  [0.10407960414886, 0.77357792854309],
  [0.95964735746384, -0.35435819625854],
  [0.50843232870102, 0.96107691526413],
  [0.17006334662437, -0.76854026317596],
  [0.25872674584389, 0.99893301725388],
  [-0.01115998718888, 0.98496019840240],
  [-0.79598701000214, 0.97138410806656],
  [-0.99264711141586, -0.99542820453644],
  [-0.99829661846161, 0.01877138763666],
  [-0.70801013708115, 0.33680686354637],
  [-0.70467054843903, 0.93272775411606],
  [0.99846023321152, -0.98725748062134],
  [-0.63364970684052, -0.16473594307899],
  [-0.16258217394352, -0.95939123630524],
  [-0.43645593523979, -0.94805032014847],
  [-0.99848473072052, 0.96245169639587],
  [-0.16796459257603, -0.98987513780594],
  [-0.87979227304459, -0.71725726127625],
  [0.44183099269867, -0.93568974733353],
  [0.93310177326202, -0.99913311004639],
  [-0.93941932916641, -0.56409376859665],
  [-0.88590002059937, 0.47624599933624],
  [0.99971461296082, -0.83889955282211],
  [-0.75376385450363, 0.00814643409103],
  [0.93887686729431, -0.11284527927637],
  [0.85126435756683, 0.52349251508713],
  [0.39701420068741, 0.81779634952545],
  [-0.37024465203285, -0.87071657180786],
  [-0.36024826765060, 0.34655734896660],
  [-0.93388813734055, -0.84476542472839],
  [-0.65298801660538, -0.18439576029778],
  [0.11960318684578, 0.99899345636368],
  [0.94292563199997, 0.83163905143738],
  [0.75081145763397, -0.35533222556114],
  [0.56721979379654, -0.24076835811138],
  [0.46857765316963, -0.30140233039856],
  [0.97312313318253, -0.99548190832138],
  [-0.38299977779388, 0.98516911268234],
  [0.41025799512863, 0.02116736955941],
  [0.09638062119484, 0.04411984235048],
  [-0.85283249616623, 0.91475564241409],
  [0.88866806030273, -0.99735265970230],
  [-0.48202428221703, -0.96805608272552],
  [0.27572581171989, 0.58634752035141],
  [-0.65889132022858, 0.58835631608963],
  [0.98838084936142, 0.99994349479675],
  [-0.20651349425316, 0.54593044519424],
  [-0.62126415967941, -0.59893679618835],
  [0.20320105552673, -0.86879181861877],
  [-0.97790551185608, 0.96290808916092],
  [0.11112534999847, 0.21484763920307],
  [-0.41368338465691, 0.28216838836670],
  [0.24133038520813, 0.51294362545013],
  [-0.66393411159515, -0.08249679952860],
  [-0.53697830438614, -0.97649902105331],
  [-0.97224736213684, 0.22081333398819],
  [0.87392479181290, -0.12796173989773],
  [0.19050361216068, 0.01602615416050],
  [-0.46353441476822, -0.95249038934708],
  [-0.07064096629620, -0.94479805231094],
  [-0.92444086074829, -0.10457590222359],
  [-0.83822596073151, -0.01695043221116],
  [0.75214684009552, -0.99955683946609],
  [-0.42102998495102, 0.99720942974091],
  [-0.72094786167145, -0.35008960962296],
  [0.78843313455582, 0.52851396799088],
  [0.97394025325775, -0.26695942878723],
  [0.99206465482712, -0.57010120153427],
  [0.76789611577988, -0.76519358158112],
  [-0.82002419233322, -0.73530179262161],
  [0.81924992799759, 0.99698424339294],
  [-0.26719850301743, 0.68903368711472],
  [-0.43311259150505, 0.85321813821793],
  [0.99194979667664, 0.91876250505447],
  [-0.80691999197006, -0.32627540826797],
  [0.43080005049706, -0.21919095516205],
  [0.67709493637085, -0.95478075742722],
  [0.56151771545410, -0.70693808794022],
  [0.10831862688065, -0.08628837019205],
  [0.91229414939880, -0.65987348556519],
  [-0.48972892761230, 0.56289243698120],
  [-0.89033657312393, -0.71656566858292],
  [0.65269446372986, 0.65916007757187],
  [0.67439478635788, -0.81684380769730],
  [-0.47770830988884, -0.16789555549622],
  [-0.99715977907181, -0.93565785884857],
  [-0.90889590978622, 0.62034398317337],
  [-0.06618622690439, -0.23812216520309],
  [0.99430269002914, 0.18812555074692],
  [0.97686403989792, -0.28664535284042],
  [0.94813650846481, -0.97506642341614],
  [-0.95434498786926, -0.79607981443405],
  [-0.49104782938957, 0.32895213365555],
  [0.99881172180176, 0.88993984460831],
  [0.50449168682098, -0.85995072126389],
  [0.47162890434265, -0.18680204451084],
  [-0.62081581354141, 0.75000673532486],
  [-0.43867015838623, 0.99998068809509],
  [0.98630565404892, -0.53578901290894],
  [-0.61510360240936, -0.89515018463135],
  [-0.03841517493129, -0.69888818264008],
  [-0.30102157592773, -0.07667808979750],
  [0.41881284117699, 0.02188098989427],
  [-0.86135452985764, 0.98947483301163],
  [0.67226862907410, -0.13494388759136],
  [-0.70737397670746, -0.76547348499298],
  [0.94044947624207, 0.09026201069355],
  [-0.82386350631714, 0.08924768865108],
  [-0.32070666551590, 0.50143420696259],
  [0.57593160867691, -0.98966425657272],
  [-0.36326017975807, 0.07440242916346],
  [0.99979043006897, -0.14130286872387],
  [-0.92366021871567, -0.97979295253754],
  [-0.44607177376747, -0.54233253002167],
  [0.44226801395416, 0.71326756477356],
  [0.03671907261014, 0.63606387376785],
  [0.52175426483154, -0.85396826267242],
  [-0.94701141119003, -0.01826348155737],
  [-0.98759609460831, 0.82288712263107],
  [0.87434792518616, 0.89399492740631],
  [-0.93412041664124, 0.41374051570892],
  [0.96063941717148, 0.93116706609726],
  [0.97534251213074, 0.86150932312012],
  [0.99642467498779, 0.70190042257309],
  [-0.94705086946487, -0.29580041766167],
  [0.91599804162979, -0.98147833347321]
];
