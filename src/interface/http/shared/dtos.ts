import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { WagerTransactionKind } from '../../../domain/wagering';

export class MoneyDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount deve ser string decimal não-negativa com até 2 casas' })
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency deve ser ISO-4217 (3 maiúsculas)' })
  currency!: string;
}

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}

export class SubmitTransactionDto {
  @IsString() @IsNotEmpty() providerId!: string;
  @IsString() @IsNotEmpty() externalTransactionId!: string;
  @IsString() @IsNotEmpty() playerId!: string;
  @IsString() @IsNotEmpty() walletId!: string;
  @IsString() @IsNotEmpty() roundId!: string;
  @IsString() @IsNotEmpty() gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
