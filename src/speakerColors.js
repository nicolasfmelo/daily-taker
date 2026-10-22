/* exported SPEAKER_COLORS speakerColor speakerClass */

var SPEAKER_COLORS = ['#3D9BFD', '#A655FD', '#3FCF70', '#22D3EE', '#F472B6', '#FACC15'];

const NEUTRAL = '#9CA4B8';

const validId = id => Number.isInteger(id) && id >= 0;

var speakerColor = id => validId(id) ? SPEAKER_COLORS[id % SPEAKER_COLORS.length] : NEUTRAL;

var speakerClass = id => validId(id) ? `speaker-${id % SPEAKER_COLORS.length}` : 'speaker-none';
