var CPEElement = require('./cpe');
var SBR = require('./sbr/sbr');

const TYPE_FILL = 0;
const TYPE_FILL_DATA = 1;
const TYPE_EXT_DATA_ELEMENT = 2;
const TYPE_DYNAMIC_RANGE = 11;
const TYPE_SBR_DATA = 13;
const TYPE_SBR_DATA_CRC = 14;

function FIL() {
    
}

FIL.decode = function(stream, count, prev, sampleRate) {
    var pos = stream.offset();
    var end = pos + count;

    while (count > 0) {
        count = this.decodeExtension(stream, count, prev, sampleRate);
    }

    stream.advance(end - stream.offset());
};

FIL.decodeExtension = function(stream, count, prev, sampleRate) {
    var type = stream.read(4);
    count -= 4;
    
    switch (type) {
        case TYPE_DYNAMIC_RANGE:
            console.log('dynamic range');
            break;
            
        case TYPE_SBR_DATA:
        case TYPE_SBR_DATA_CRC:
            if (prev) {
                // prev.sbr = new SBR(sampleRate, false);
                prev.sbr = SBR.get(sampleRate, false);
                prev.sbr.decode(stream, count, prev instanceof CPEElement, type === TYPE_SBR_DATA_CRC);
            }
            return 0;
            
        case TYPE_FILL:
        case TYPE_FILL_DATA:
        case TYPE_EXT_DATA_ELEMENT:
            console.log('OTHER')
            break;
    }
    
    // stream.advance(count);
};

module.exports = FIL;
