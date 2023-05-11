/* eslint-disable */

const { parseRelayAdaptRevertData } = require('@railgun-community/quickstart');
const ethers = require('ethers');

function main(args) {
  const returnValue = args.length ? args[0] : null;
  if (!returnValue) {
    throw new Error('No return value provided');
  }

  const RETURN_DATA_RELAY_ADAPT_STRING_PREFIX = '0x5c0dee5d';

  if (returnValue.match(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX)) {
    const strippedReturnValue = returnValue.replace(
      RETURN_DATA_RELAY_ADAPT_STRING_PREFIX,
      '0x',
    );
    return parseRelayAdaptRevertData(strippedReturnValue);
  }

  const RETURN_DATA_STRING_PREFIX = '0x08c379a0';
  if (returnValue.match(RETURN_DATA_STRING_PREFIX)) {
    const strippedReturnValue = returnValue.replace(
      RETURN_DATA_STRING_PREFIX,
      '0x',
    );
    const result = ethers.utils.defaultAbiCoder.decode(
      ['string'],
      strippedReturnValue,
    );
    return result[0];
  }

  return `Not a RelayAdapt return value: must be prefixed with ${RETURN_DATA_RELAY_ADAPT_STRING_PREFIX}`;
}

const consoleArgs = process.argv.slice(2);

const debugString = main(consoleArgs);
console.log(`RELAY ADAPT ERROR: ${debugString}`);
