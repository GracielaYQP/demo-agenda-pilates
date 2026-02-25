import { AfterViewInit, Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';


@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NgIf, RouterModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent implements OnInit, AfterViewInit {
  localStorage = localStorage;
  nombre: string | null = null;
  menuAbierto = false;

  constructor(public auth: AuthService, private router: Router, private el: ElementRef) {}
  
  ngOnInit() {
    this.nombre = localStorage.getItem('nombreUsuario');
  }

  ngAfterViewInit() {
   
    setTimeout(() => this.setHeaderVar(), 0);
  }

  @HostListener('window:resize')
  onResize() {
    this.setHeaderVar();
  }

  toggleMenu() {
    this.menuAbierto = !this.menuAbierto;
    this.setHeaderVar();
  }

  cerrarMenu() {
    this.menuAbierto = false;
    this.setHeaderVar();
  }

  get isAdmin(): boolean {
    const rol = (this.auth.getRol() || '').trim().toLowerCase();
    return rol === 'admin' || rol === 'superadmin';
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']).then(() => {
      window.location.reload();
    });
  }

  private setHeaderVar() {
    const headerEl = this.el.nativeElement.querySelector('.site-header') as HTMLElement | null;
    const h = headerEl?.offsetHeight ?? 84;
    document.documentElement.style.setProperty('--header-h', `${h}px`);
  }

  @HostListener('window:storage')
  onStorageChange() {
    this.setHeaderVar();
  }
}
