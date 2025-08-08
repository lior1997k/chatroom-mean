import { Routes } from '@angular/router';
import { ChatComponent } from './pages/chat/chat';
import { LoginComponent } from './pages/login/login';
import { RegisterComponent } from './pages/register/register';
import { AuthGuard } from './guards/auth-guard';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'chat', component: ChatComponent, canActivate: [AuthGuard] },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
];
