import CPEElement from './cpe';
import SBR from './sbr/SBR';

const TYPE_FILL = 0;
const TYPE_FILL_DATA = 1;
const TYPE_EXT_DATA_ELEMENT = 2;
const TYPE_DYNAMIC_RANGE = 11;
const TYPE_SBR_DATA = 13;
const TYPE_SBR_DATA_CRC = 14;

export function decode(stream, count, prev, sampleRate) {
  let end = stream.offset() + count;

  while (count > 0) {
    count -= decodeExtension(stream, count, prev, sampleRate);
  }

  stream.seek(end);
}

function decodeExtension(stream, count, prev, sampleRate) {
  let end = stream.offset() + count;
  let type = stream.read(4);
  
  switch (type) {
    case TYPE_DYNAMIC_RANGE:
      return skipDynamicRange(stream);
      
    case TYPE_SBR_DATA:
    case TYPE_SBR_DATA_CRC:
      if (prev) {
        prev.sbr = SBR.decode(stream, sampleRate, prev instanceof CPEElement, type === TYPE_SBR_DATA_CRC);
      }
      // fall through
      
    default:
      stream.seek(end);
      return count;
  }
}

function skipDynamicRange(stream) {
  let offset = stream.offset();
  let drc_num_bands = 1;
  
  if (stream.read(1)) { // pce_tag_present
    stream.advance(4); // pce_instance_tag
    stream.advance(4); // tag_reserved_bits
  }
  
  if (stream.read(1)) { // excluded_chns_present
    let n = 0;
    do {
      stream.advance(7);
      n += 7;
    } while (n < 57 && stream.read(1));
  }
  
  if (stream.read(1)) { // drc_bands_present
    drc_num_bands += stream.advance(4);
    stream.advance(4); // interpolation_scheme
    stream.advance(8 * drc_num_bands); // band top
  }
  
  if (stream.read(1)) { // prog_ref_level_present
    stream.advance(7); // prog_ref_level
    stream.advance(1); // prog_ref_level_reserved_bits
  }
  
  stream.advance(8 * drc_num_bands); // dyn_rng_sgn and dyn_rng_ctl
  
  return stream.offset() - offset;
}
