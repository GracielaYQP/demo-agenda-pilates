import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class RegisterInvitacionDto {
  
  @IsString()
  @IsNotEmpty()
  dni!: string;

  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsString()
  @IsNotEmpty()
  apellido!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsNotEmpty()
  @IsIn(['0','4', '8', '12'])
  planMensual!: '0' |'4' | '8' | '12';

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  token!: string;
}
