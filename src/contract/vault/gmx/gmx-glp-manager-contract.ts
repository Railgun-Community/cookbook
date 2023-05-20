import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi-typechain/abi';
import { Contract } from '@ethersproject/contracts';
import { GlpManager } from '../../../abi-typechain/vault/gmx/GlpManager';

export class GmxGlpManagerContract {
  private readonly contract: GlpManager;

  constructor(address: string, provider: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX GlpManager contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.glpManager,
      provider,
    ) as GlpManager;
  }

  getGLPPriceInUSD(isMintingGLP: boolean) {
    const maximize = isMintingGLP;
    return this.contract.getPrice(maximize);
  }
}
