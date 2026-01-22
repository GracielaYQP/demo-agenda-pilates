import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterAdminDemoDto {
  @IsNotEmpty()
  nombre!: string;

  @IsNotEmpty()
  apellido!: string;

  @IsNotEmpty()
  telefono!: string;

  @IsEmail()
  email!: string;

  @MinLength(6)
  password!: string;
}
