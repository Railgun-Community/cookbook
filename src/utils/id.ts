export const generateID = () => {
  const CHARSET = 'abcdefghijklnopqrstuvwxyz0123456789';
  let retVal = '';
  for (let i = 0; i < length; i += 1) {
    retVal += CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
  }
  return retVal;
};
