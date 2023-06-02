/* eslint-disable */

const { parseRelayAdaptReturnValue } = require('@railgun-community/wallet');

function main(args) {
  const returnValue = args.length ? args[0] : null;
  if (!returnValue) {
    throw new Error('No return value provided');
  }

  return parseRelayAdaptReturnValue(returnValue);
}

const consoleArgs = process.argv.slice(2);

const debugString = main(consoleArgs);
console.log(`RELAY ADAPT ERROR: ${debugString}`);
