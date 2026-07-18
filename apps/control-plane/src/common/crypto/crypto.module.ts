import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { AssetTokenService } from '../asset-token/asset-token.service';

@Global()
@Module({
  providers: [CryptoService, AssetTokenService],
  exports: [CryptoService, AssetTokenService],
})
export class CryptoModule {}
