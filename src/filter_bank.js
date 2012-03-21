//import "mdct.js"

function generateSineWindow(len) {
    var d = new Float32Array(len);
    for (var i = 0; i < len; i++) {
        d[i] = Math.sin((i + 0.5) * (Math.PI / (2.0 * len)))
    }
    return d;
}

function generateKBDWindow(alpha, len) {
    var PIN = Math.PI / len,
        out = new Float32Array(len),
        sum = 0,
        f = new Float32Array(len),
        alpha2 = (alpha * PIN) * (alpha * PIN);
        
    for (var n = 0; n < len; n++) {
        var tmp = n * (len - n) * alpha2,
            bessel = 1;
            
        for (var j = 0; j < 50; j++) {
            bessel *= tmp / (j * j) + 1;
        }
        
        sum += bessel;
        f[n] = sum;
    }
    
    sum++;
    for (n = 0; n < len; n++) {
        out[n] = Math.sqrt(f[n] / sum);
    }
    
    return out;
}

const SINE_1024 = generateSineWindow(1024),
      SINE_128  = generateSineWindow(128),
      KBD_1024  = generateKBDWindow(4, 1024),
      KBD_128   = generateKBDWindow(6, 128),
      LONG_WINDOWS = [SINE_1024, KBD_1024],
      SHORT_WINDOWS = [SINE_128, KBD_128];

function FilterBank(smallFrames, channels) {
    if (smallFrames) {
        throw new Error("WHA?? No small frames allowed.");
    }
    
    this.length = 1024;
    this.shortLength = 128;
    
    this.mid = (this.length - this.shortLength) / 2;
    this.trans = this.shortLength / 2;
    
    this.mdctShort = new MDCT(this.shortLength * 2);
    this.mdctLong  = new MDCT(this.length * 2);
    
    this.overlaps  = new Array(channels);
    for (var i = 0; i < channels; i++) {
        this.overlaps[i] = new Float32Array(this.length);
    }
    
    this.buf = new Float32Array(2 * length);
}

FilterBank.prototype.process = function(info, input, output, channel) {
    var overlap = this.overlaps[channel],
        windowShape = info.windowShape[1],
        windowShapePrev = info.windowShape[0],
        length = this.length,
        shortLen = this.shortLength,
        mid = this.mid,
        trans = this.trans,
        buf = this.buf;
    
    switch (info.windowSequence) {
        case ONLY_LONG_SEQUENCE:
            // console.log('ONLY_LONG_SEQUENCE');
            this.mdctLong.process(input, 0, output, 0);
            
            // add second half output of previous frame to windowed output of current frame
            for(var i = 0; i < length; i++) {
                output[i] = overlap[i] + (buf[i] * LONG_WINDOWS[windowShapePrev][i]);
            }

            // window the second half and save as overlap for next frame
            for(var i = 0; i < length; i++) {
                overlap[i] = buf[length + i] * LONG_WINDOWS[windowShape][length - 1 - i];
            }
            
            break;
            
        case LONG_START_SEQUENCE:
            // console.log('LONG_START_SEQUENCE');
            this.mdctLong.process(input, 0, output, 0);
            
            // add second half output of previous frame to windowed output of current frame
            for(i = 0; i<length; i++) {
                output[i] = overlap[i] + (buf[i] * LONG_WINDOWS[windowShapePrev][i]);
            }

            //window the second half and save as overlap for next frame
            for(i = 0; i < mid; i++) {
                overlap[i] = buf[length + i];
            }
            
            for(i = 0; i < shortLen; i++) {
                overlap[mid + i] = buf[length + mid + i] * SHORT_WINDOWS[windowShape][shortLen - i - 1];
            }
            
            for(i = 0; i < mid; i++) {
                overlap[mid + shortLen + i] = 0;
            }
            
            break;
            
        case EIGHT_SHORT_SEQUENCE:
            for (var i = 0; i < 8; i++)
				this.mdctShort.process(input, i * shortLen, buf, 2 * i * shortLen);
			
			// add second half output of previous frame to windowed output of current frame
			for(var i = 0; i < mid; i++)
				output[i] = overlap[i];
			
			for(var i = 0; i < shortLen; i++) {
				output[mid + i] = overlap[mid + i] + buf[i] * SHORT_WINDOWS[windowShapePrev][i];
				output[mid + 1 * shortLen + i] = overlap[mid + shortLen * 1 + i] + (buf[shortLen * 1 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 2 + i]  * SHORT_WINDOWS[windowShape][i]);
				output[mid + 2 * shortLen + i] = overlap[mid+shortLen * 2 + i] + (buf[shortLen * 3 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 4 + i] * SHORT_WINDOWS[windowShape][i]);
				output[mid + 3 * shortLen + i] = overlap[mid + shortLen * 3 + i] + (buf[shortLen * 5 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 6 + i] * SHORT_WINDOWS[windowShape][i]);
				
				if(i < trans)
				    output[mid + 4 * shortLen + i] = overlap[mid + shortLen * 4 + i] + (buf[shortLen * 7 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 8 + i] * SHORT_WINDOWS[windowShape][i]);
			}
			
			// window the second half and save as overlap for next frame
			for(var i = 0; i < shortLen; i++) {
				if(i >= trans) 
				    overlap[mid + 4 * shortLen + i - length] = (buf[shortLen * 7 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 8 + i] * SHORT_WINDOWS[windowShape][i]);
				    
				overlap[mid + 5 * shortLen + i - length] = (buf[shortLen * 9 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 10 + i] * SHORT_WINDOWS[windowShape][i]);
				overlap[mid + 6 * shortLen + i - length] = (buf[shortLen * 11 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 12 + i]*SHORT_WINDOWS[windowShape][i]);
				overlap[mid + 7 * shortLen + i - length] = (buf[shortLen * 13 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]) + (buf[shortLen * 14 + i]*SHORT_WINDOWS[windowShape][i]);
				overlap[mid + 8 * shortLen + i - length] = (buf[shortLen * 15 + i] * SHORT_WINDOWS[windowShape][shortLen - 1 - i]);
			}
			
			for(var i = 0; i<mid; i++)
				overlap[mid + shortLen + i] = 0;
			
            break;
            
        case LONG_STOP_SEQUENCE:
            this.mdctLong.process(input, 0, buf, 0);
            
			// add second half output of previous frame to windowed output of current frame
			// construct first half window using padding with 1's and 0's
			for(var i = 0; i < mid; i++)
				output[i] = overlap[i];
				
			for(var i = 0; i < shortLen; i++)
				output[mid + i] = overlap[mid + i] + (buf[mid + i] * SHORT_WINDOWS[windowShapePrev][i]);

			for(var i = 0; i < mid; i++)
				output[mid + shortLen + i] = overlap[mid + shortLen + i] + buf[mid + shortLen + i];

			// window the second half and save as overlap for next frame
			for(var i = 0; i < length; i++)
				overlap[i] = buf[length + i] * LONG_WINDOWS[windowShape][length - 1 - i];
            
            break;
    }
}