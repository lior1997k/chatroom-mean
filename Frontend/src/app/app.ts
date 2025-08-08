import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router'; // 👈 Required!

@Component({
  selector: 'app-root',
  standalone: true, // 👈 THIS IS CRITICAL
  imports: [RouterOutlet], // 👈 This enables <router-outlet>
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {
  title = 'frontend';
}