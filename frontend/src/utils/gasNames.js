// Render chemical formulas with true subscripts: digits that directly follow
// a letter become Unicode subscript characters (CH4 -> CH₄, H2S -> H₂S,
// N2O -> N₂O). Digits elsewhere ("Sensor 1") are left untouched.
const SUBSCRIPT_DIGITS = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄',
  5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉'
};

export const formatGasName = (name) => {
  if (typeof name !== 'string') return name;
  return name.replace(/([A-Za-z])(\d+)/g, (match, letter, digits) => (
    letter + digits.split('').map(d => SUBSCRIPT_DIGITS[d] ?? d).join('')
  ));
};
