import fs from 'fs';
import { JsonRpcProvider } from 'ethers';
import {
  NetworkName
} from '@railgun-community/shared-models';
import { getTestProvider } from './shared.test';


const SNAPSHOT_FILE = 'snapshot.json';

interface Snapshot {
  id: string;
  networkName: NetworkName;
}

let provider: JsonRpcProvider;

try { 
  provider = getTestProvider();
} catch(err) {
  provider = new JsonRpcProvider()
}

export const snapshotExists = (): string | null => {
  if (fs.existsSync(SNAPSHOT_FILE)) {
    // eslint-disable any
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    if (snapshot.networkName === networkName) {
      console.log('Loading existing snapshot');
      return snapshot.id;
    }
  }
  return null;
}


export const createOrLoadSnapshot = async (networkName: NetworkName): Promise<string> => {
  
  if (fs.existsSync(SNAPSHOT_FILE)) {
    // eslint-disable any
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    if (snapshot.networkName === networkName) {
      console.log('Loading existing snapshot');
      return snapshot.id;
    }
  }

  console.log('Creating new snapshot');
  // await setupForkTests();
  
  const snapshotId = await provider.send('evm_snapshot', []);
  const snapshot: Snapshot = { id: snapshotId, networkName };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
  
  return snapshotId;
}

export const restoreSnapshot = (snapshotId: string) => {
  return provider.send('evm_revert', [snapshotId]);
}

