<script lang="ts">
	import { goto } from '$app/navigation';
	import { signInEmail, signUpEmail } from '$lib/api';

	let message = $state('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		message = '';

		const form = event.currentTarget as HTMLFormElement;
		const submitter = event.submitter as HTMLButtonElement | null;
		const formData = new FormData(form);
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const name = formData.get('name')?.toString() ?? '';

		try {
			if (submitter?.value === 'register') {
				await signUpEmail(email, password, name);
			} else {
				await signInEmail(email, password);
			}

			await goto('/demo/better-auth');
		} catch (error) {
			message = error instanceof Error ? error.message : 'Authentication failed';
		}
	}
</script>

<h1>Login</h1>
<form onsubmit={handleSubmit}>
	<label>
		Email
		<input type="email" name="email" />
	</label>
	<label>
		Password
		<input type="password" name="password" />
	</label>
	<label>
		Name (for registration)
		<input name="name" />
	</label>
	<button>Login</button>
	<button type="submit" value="register">Register</button>
</form>
<p style="color: red">{message}</p>
