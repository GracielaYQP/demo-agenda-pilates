import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { NgClass, NgIf } from '@angular/common';
import { fromEvent, merge, startWith, Subscription, switchMap, timer } from 'rxjs';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgClass],
})
export class LoginComponent implements OnInit, OnDestroy, AfterViewInit{
  @ViewChild('usuarioInput') usuarioInput!: ElementRef<HTMLInputElement>;
  form: FormGroup;
  error: string = '';
  showPassword: boolean = false;
  isAdmin: boolean = false;
  email: string = '';
  password: string = '';
  showInviteHint = false;             
  private idleSub?: Subscription;      
  private readonly IDLE_MS = 6000;
  
  constructor(
    private fb: FormBuilder, 
    private auth: AuthService, 
    private router: Router,
    private el: ElementRef
    ) {
    this.form = this.fb.group({
      usuario: ['', Validators.required],
      password: ['', Validators.required],
    });
    
  }

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => {
      if (this.form.valid) this.showInviteHint = false;
    });
    this.startIdleWatcher();
  }

  ngAfterViewInit() {
    this.focusUsuario();
  }

  private focusUsuario() {
    setTimeout(() => this.usuarioInput?.nativeElement?.focus(), 0);
  }

  ngOnDestroy(): void {
    this.idleSub?.unsubscribe();
  }

  get Usuario() {
    return this.form.get('usuario');
  }

  get Password() {
    return this.form.get('password');
  }

  togglePasswordVisibility() {  
    this.showPassword = !this.showPassword;
  }

  submit() {
    if (this.form.invalid) return;

    console.log('🔐 Enviando datos de login:', this.form.value);

    this.auth.login(this.form.value).subscribe({
      next: (res: any) => {
        console.log('✅ Respuesta del login:', res);
        console.log('rol directo:', res?.rol);
        console.log('rol en user:', res?.user?.rol);
        console.log('role alternativo:', res?.role);

        const token = res?.access_token ?? res?.token;
        if (token) localStorage.setItem('token', token);

        const rol = (res?.rol ?? res?.user?.rol ?? res?.role ?? '')
          .toString()
          .trim()
          .toLowerCase();

        if (rol) localStorage.setItem('rol', rol);

        const nombre = (res?.nombre ?? res?.user?.nombre ?? '').toString().trim();
        const nivel = (res?.nivel ?? res?.user?.nivel ?? '').toString().trim();

        if (nombre) localStorage.setItem('nombreUsuario', nombre);
        if (nivel) localStorage.setItem('nivelUsuario', nivel);

        console.log('LS rol guardado (después):', localStorage.getItem('rol'));

        // navegar según rol (recomendado)
        if (rol === 'admin' || rol === 'superadmin') {
          this.router.navigate(['/gestion-turnos']);
        } else {
          this.router.navigate(['/horarios-disponibles']);
        }
      },
      error: (err) => {
        console.log('❌ Error al iniciar sesión:', err);
        this.error = err.error?.message || 'Error desconocido al iniciar sesión';
        this.showInviteHint = true;
        this.form.reset();
        this.focusUsuario();
      }
    });
  }

  solicitarResetPorWhatsapp() {
    const usuario = (this.form.value.usuario ?? '').toString().trim();

    if (!usuario) {
      this.error = 'Ingresá tu email o tu teléfono para recuperar tu contraseña';
      return;
    }

    this.auth.solicitarResetWhatsapp({ usuario }).subscribe({
      next: (res) => {
        const url = res.whatsappUrl 
          ?? `https://wa.me/${res.telefono}?text=${encodeURIComponent(res.mensaje ?? res.resetLink)}`;
        window.open(url, '_blank');
      },
      error: (err) => {
        this.error = err.error?.message || 'No se pudo enviar el link por WhatsApp.';
      }
    });
  }

  private startIdleWatcher() {
    const inputs = this.el.nativeElement.querySelectorAll('input');

    const streams = [
      fromEvent(document, 'mousemove'),
      fromEvent(document, 'keydown'),
      ...Array.from(inputs).map((i: any) => fromEvent(i, 'input')),
      ...Array.from(inputs).map((i: any) => fromEvent(i, 'focus')),
      ...Array.from(inputs).map((i: any) => fromEvent(i, 'paste')),
    ];

    this.idleSub = merge(...streams)
      .pipe(
        startWith('init'),              
        switchMap(() => timer(this.IDLE_MS))
      )
      .subscribe(() => this.checkAndShowHint());
  }

  private checkAndShowHint() {
    const { usuario, password } = this.form.value ?? {};
    const u = (usuario ?? '').toString().trim();
    const p = (password ?? '').toString().trim();

    const noCreds = (!u && !p);
    const incompleto = (!!u && !p) || (!u && !!p);

    if ((noCreds || incompleto) && !this.form.valid) {
      this.showInviteHint = true;
    }
  }

}


