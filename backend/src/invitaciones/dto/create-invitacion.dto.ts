import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class CreateInvitacionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{7,15}$/, {
    message: 'El teléfono debe tener entre 7 y 15 dígitos (puede incluir +)',
  })
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 20)
  nivel_asignado!: string;

  @IsString()
  @IsNotEmpty()
  @Length(20, 200) // o @IsUUID() si usás UUID
  token!: string;
}
