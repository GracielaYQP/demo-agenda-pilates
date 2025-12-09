import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  usuario!: string;

  @IsString()
  @MinLength(6)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  password!: string;
}

