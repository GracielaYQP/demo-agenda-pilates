import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NgClass, NgIf } from '@angular/common';
import { AuthService } from '../../services/auth.service';


@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css'],
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgClass],
})
export class ResetPasswordComponent {
  form: FormGroup;
  token: string = '';
  error: string = '';
  showPassword: boolean = false;
  mensaje: string = '';


  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {
    this.form = this.fb.group({
      password: [
        '',
        [
          Validators.required,
          Validators.pattern(
            /^(?=(?:.*\d))(?=.*[A-Z])(?=.*[a-z])(?=.*[.,*!?¿¡/#$%&])\S{8,20}$/
          ),
        ],
      ],
      confirmPassword: ['', Validators.required],
    }, {
      validators: this.passwordsMatchValidator
    });

    this.token = this.route.snapshot.paramMap.get('token') || '';
  }

  // Verificación de que las contraseñas coincidan
  passwordsMatchValidator(group: AbstractControl): { [key: string]: boolean } | null {
    const password = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    return password === confirm ? null : { passwordMismatch: true };
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  submit() {
    if (this.form.invalid || !this.token) return;

    const newPassword = this.form.get('password')!.value;

    this.authService.resetPassword(this.token, newPassword).subscribe({
      next: (res) => {
        // Limpiar error previo (si lo había)
        this.error = '';
        // Mostrar mensaje de éxito
        this.mensaje = res.message || 'Contraseña restablecida con éxito';

        // Redirigir al login luego de 2 segundos
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        console.error('❌ Error al restablecer contraseña:', err);

        // Limpiar mensajes de éxito
        this.mensaje = '';

        // Mostrar el error que envía el backend
        this.error = err.error?.message || 'Error al restablecer la contraseña';
      }
    });
  }


  get Password() {
    return this.form.get('password');
  }

}

