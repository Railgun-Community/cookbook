import fs from 'fs';
import { JsonRpcProvider } from 'ethers';
import {
  NetworkName
} from '@railgun-community/shared-models';
import { getLocalhostRPC, getRPCPort } from './common.test';

const SNAPSHOT_FILE = 'snapshot.json';

interface Snapshot {
  id: string;
  networkName: NetworkName;
}

// TODO: Use getTestProvider function from ./shared-tests
const getProvider = (networkName: NetworkName): JsonRpcProvider => {
  const port = getRPCPort(networkName);
  const localhost = getLocalhostRPC(port);
  const testRPCProvider = new JsonRpcProvider(localhost, undefined, {
    polling: true,
  });
  return testRPCProvider;
};


export const loadSnapshot = (networkName: NetworkName): string | null => {
  if (fs.existsSync(SNAPSHOT_FILE)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    if (snapshot.networkName === networkName) {
      // eslint-disable-next-line no-console
      console.log('Loading existing snapshot');
      return snapshot.id;
    }
  }
  return null;
}

export const createSnapshot = async (networkName: NetworkName): Promise<string> => {
  console.log('Creating new snapshot');

  const provider = getProvider(networkName);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const snapshotId = await provider.send('evm_snapshot', []);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const snapshot: Snapshot = { id: snapshotId, networkName };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
  return snapshotId;
};

export const restoreSnapshot = (networkName: NetworkName, snapshotId: string) => {
  const provider = getProvider(networkName);
  return provider.send('evm_revert', [snapshotId]);
}

