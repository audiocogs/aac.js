//import "ics.js"

const MAX_MS_MASK = 128;

const MASK_TYPE_ALL_0 = 0,
      MASK_TYPE_USED = 1,
      MASK_TYPE_ALL_1 = 2,
      MASK_TYPE_RESERVED = 3;

/*
 * CPEElement - represents a channel pair element
 * Table 4.5
 */
function CPEElement(frameLength) {
    this.ms_used = [];
    this.left = new ICStream(frameLength);
    this.right = new ICStream(frameLength);
}

CPEElement.prototype.decode = function(stream, config) {
    var left = this.left,
        right = this.right,
        ms_used = this.ms_used;
        
    if (this.commonWindow = !!stream.readOne()) {
        left.info.decode(stream, config, true);
        right.info.set(left.info)

        var mask = stream.readSmall(2);
        this.maskPresent = !!mask;
        
        switch (mask) {
            case MASK_TYPE_USED:
                var len = left.info.groupCount * left.info.maxSFB;
                for (var i = 0; i < len; i++) {
                    ms_used[i] = !!stream.readOne();
                }
                break;
            
            case MASK_TYPE_ALL_0:    
            case MASK_TYPE_ALL_1:
                var val = !!mask;
                for (var i = 0; i < MAX_MS_MASK; i++) {
                    ms_used[i] = val;
                }
                break;
                
            default:
                throw new Error("Reserved ms mask type: " + mask);
        }
    } else {
        for (var i = 0; i < MAX_MS_MASK; i++)
            ms_used[i] = false;
    }
    
    left.decode(stream, config, this.commonWindow);
    right.decode(stream, config, this.commonWindow);
}