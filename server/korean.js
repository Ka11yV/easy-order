const units = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
const tens = ['', '열', '스무', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
export function cupCount(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 99) return `${value}잔`;
  const ten = Math.floor(n / 10), unit = n % 10;
  return `${ten === 2 && unit ? '스물' : tens[ten]}${units[unit]} 잔`;
}
export function speechText(text) {
  return text.replace(/(?<![\d,.])([1-9]\d?)\s*잔/g, (_, number) => cupCount(number));
}
export function phoneNumber(text) {
  // STT can return digits, hyphens, or Korean digit names. Reject incomplete/extra numbers.
  const digits = { 공: '0', 영: '0', 일: '1', 이: '2', 삼: '3', 사: '4', 오: '5', 육: '6', 칠: '7', 팔: '8', 구: '9' };
  const cleaned = text.trim().replace(/^(제\s*)?(휴대폰\s*|전화\s*)?번호[는가]?\s*/, '').replace(/(입니다|이에요|예요|이요|요)[.!?]?$/, '').trim();
  if (!/^[\d공영일이삼사오육칠팔구\s().-]+$/.test(cleaned)) return null;
  const number = cleaned.replace(/[공영일이삼사오육칠팔구]/g, char => digits[char]).replace(/\D/g, '');
  return /^010\d{8}$/.test(number) ? number : null;
}
