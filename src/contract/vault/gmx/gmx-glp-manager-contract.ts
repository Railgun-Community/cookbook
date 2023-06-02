import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi/abi';
import { Contract, Provider } from 'ethers';
import { GlpManager } from '../../../typechain';

export class GmxGlpManagerContract {
  private readonly contract: GlpManager;

  constructor(address: string, provider: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX GlpManager contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.glpManager,
      provider,
    ) as unknown as GlpManager;
  }

  getGLPPriceInUSD(isMintingGLP: boolean) {
    const maximize = isMintingGLP;
    return this.contract.getPrice(maximize);
  }
}
