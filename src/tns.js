const TNS_MAX_ORDER = 20,
      SHORT_BITS = [1, 4, 3],
      LONG_BITS = [2, 6, 5];
      
const TNS_COEF_1_3 = [0.00000000, -0.43388373, 0.64278758, 0.34202015],

      TNS_COEF_0_3 = [0.00000000, -0.43388373, -0.78183150, -0.97492790,
		              0.98480773, 0.86602539, 0.64278758, 0.34202015],
		              
	  TNS_COEF_1_4 = [0.00000000, -0.20791170, -0.40673664, -0.58778524,
              		  0.67369562, 0.52643216, 0.36124167, 0.18374951],
              		  
      TNS_COEF_0_4 = [0.00000000, -0.20791170, -0.40673664, -0.58778524,
              		  -0.74314481, -0.86602539, -0.95105654, -0.99452192,
              		  0.99573416, 0.96182561, 0.89516330, 0.79801720,
              		  0.67369562, 0.52643216, 0.36124167, 0.18374951],
              		  
      TNS_TABLES = [TNS_COEF_0_3, TNS_COEF_0_4, TNS_COEF_1_3, TNS_COEF_1_4];

function TNS() {
    this.nFilt = new Int32Array(8);
    this.length = new Array(8);
    this.direction = new Array(8);
    this.order = new Array(8);
    this.coef = new Array(8);
    
    // Probably could allocate these as needed
    for (var w = 0; w < 8; w++) {
        this.length[w] = new Int32Array(4);
        this.direction[w] = new Array(4);
        this.order[w] = new Int32Array(4);
        this.coef[w] = new Array(4);
        
        for (var filt = 0; filt < 4; filt++) {
            this.coef[w][filt] = new Float32Array(TNS_MAX_ORDER);
        }
    }
}

TNS.prototype.decode = function(stream, info) {
    var windowCount = info.windowCount,
        bits = info.windowSequence === EIGHT_SHORT_SEQUENCE ? SHORT_BITS : LONG_BITS;
    
    for (var w = 0; w < windowCount; w++) {
        if (this.nFilt[w] = stream.readSmall(bits[0])) {
            var coefRes = stream.readOne();
            
            for (var filt = 0; filt < this.nFilt[w]; filt++) {
                this.length[w][filt] = stream.readSmall(bits[1]);
                
                if ((this.order[w][filt] = stream.readSmall(bits[2])) > 20)
                    throw new Error("TNS filter out of range: " + this.order[w][filt]);
                
                if (this.order[w][filt]) {
                    this.direction[w][filt] = !!stream.readOne();
                    var coefCompress = stream.readOne(),
                        coefLen = coefRes + 3 - coefCompress,
                        tmp = 2 * coefCompress + coefRes;
                        
                    for (var i = 0; i < this.order[w][filt]; i++)
                        this.coef[w][filt][i] = TNS_TABLES[tmp][stream.readSmall(coefLen)];
                }
                    
            }
        }
    }
}

TNS.prototype.process = function() {
    // TODO: implement
}