import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { LoginComponent } from 'src/app/auth/login/login.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LoginComponent, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})

export class HomeComponent {

  constructor(private router: Router) {}

  irAlLogin(): void {
    this.router.navigate(['/login']);
  }

}
