/*
 * AAC.js - Advanced Audio Coding decoder in JavaScript
 * Created by Devon Govett
 * Copyright (c) 2012, Official.fm Labs
 *
 * AAC.js is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Lesser General Public License as 
 * published by the Free Software Foundation; either version 3 of the 
 * License, or (at your option) any later version.
 *
 * AAC.js is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY 
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General 
 * Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library.
 * If not, see <http://www.gnu.org/licenses/>.
 */
    
function FFT(length) {
    this.length = length;
    
    this.roots = generateFFTTable(length);

    // processing buffers
    this.buf = new Float32Array(length * 2);
    
    // Bit reversal lookup table
    this.rev = new Uint16Array(length);
    var ii = 0;
    for (let i = 0; i < length; i++) {
      this.rev[ii] = i;
      
      let k = length >>> 1;
      while (ii >= k && k > 0) {
          ii -= k;
          k >>= 1;
      }

      ii += k;
    }
}

function generateFFTTable(len) {
    var t = 2 * Math.PI / len,
        cosT = Math.cos(t),
        sinT = Math.sin(t),
        f[len][3] = new Float32Array(len * 3);

    f[0][0] = 1;
    f[0][1] = 0;
    f[0][2] = 0;

    for (var i = 1; i < len; i++) {
        f[i][0] = f[i - 1][0] * cosT + f[i - 1][2] * sinT;
        f[i][2] = f[i - 1][2] * cosT - f[i - 1][0] * sinT;
        f[i][1] = -f[i][2];
    }

    return f;
}

FFT.prototype.process = function(input[length][2], forward) {
    var length = this.length,
        imOffset = (forward ? 2 : 1),
        scale = (forward ? length : 1),
        buf[length][2] = this.buf,
        roots[length][3] = this.roots,
        rev = this.rev;

    // bit-reversal
    for (var i = 0; i < length; i++) {
        buf[i][0] = input[rev[i]][0];
        buf[i][1] = input[rev[i]][1];
    }

    for (var i = 0; i < length; i++) {
        input[i][0] = buf[i][0];
        input[i][1] = buf[i][1];
    }

    // bottom base-4 round
    for (var i = 0; i < length; i += 4) {
        let a0 = input[i][0] + input[i + 1][0];
        let a1 = input[i][1] + input[i + 1][1];
        let b0 = input[i + 2][0] + input[i + 3][0];
        let b1 = input[i + 2][1] + input[i + 3][1];
        let c0 = input[i][0] - input[i + 1][0];
        let c1 = input[i][1] - input[i + 1][1];
        let d0 = input[i + 2][0] - input[i + 3][0];
        let d1 = input[i + 2][1] - input[i + 3][1];
        input[i][0] = a0 + b0;
        input[i][1] = a1 + b1;
        input[i + 2][0] = a0 - b0;
        input[i + 2][1] = a1 - b1;

        let e10 = c0 - d1;
        let e11 = c1 + d0;
        let e20 = c0 + d1;
        let e21 = c1 - d0;

        if (forward) {
            input[i + 1][0] = e20;
            input[i + 1][1] = e21;
            input[i + 3][0] = e10;
            input[i + 3][1] = e11;
        } else {
            input[i + 1][0] = e10;
            input[i + 1][1] = e11;
            input[i + 3][0] = e20;
            input[i + 3][1] = e21;
        }
    }

    // iterations from bottom to top
    for (var i = 4; i < length; i <<= 1) {
        var shift = i << 1,
            m = length / shift;

        for(var j = 0; j < length; j += shift) {
            for(var k = 0; k < i; k++) {
                var km = k * m,
                    rootRe = roots[km][0],
                    rootIm = roots[km][imOffset],
                    zRe = input[i + j + k][0] * rootRe - input[i + j + k][1] * rootIm,
                    zIm = input[i + j + k][0] * rootIm + input[i + j + k][1] * rootRe;

                input[i + j + k][0] = (input[j + k][0] - zRe) * scale;
                input[i + j + k][1] = (input[j + k][1] - zIm) * scale;
                input[j + k][0] = (input[j + k][0] + zRe) * scale;
                input[j + k][1] = (input[j + k][1] + zIm) * scale;
            }
        }
    }
};

module.exports = FFT;
