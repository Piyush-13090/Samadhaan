import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  /**
   * Only length-bounded, not strength-checked: strength rules belong at
   * registration. Applying them here would reject a legitimate older password
   * and, worse, reveal the current policy to an attacker probing the endpoint.
   * The upper bound stops a megabyte of input reaching Argon2.
   */
  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  @MaxLength(128)
  password!: string;
}
