import { IsString, Length } from 'class-validator';
// Si usás UUID: import { IsUUID } from 'class-validator';

export class VerifyInvitationDto {
  @IsString()
  @Length(20, 200) 
  token!: string;
}
