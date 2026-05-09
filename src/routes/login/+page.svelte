<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<main class="login-shell">
	<section class="login-panel" aria-labelledby="login-title">
		<div>
			<p class="eyebrow">Kanban workspace</p>
			<h1 id="login-title">Sign in or create an account</h1>
		</div>

		<form method="post" action="?/signInEmail" use:enhance>
			<label>
				Email
				<input type="email" name="email" autocomplete="email" required />
			</label>

			<label>
				Password
				<input type="password" name="password" autocomplete="current-password" required />
			</label>

			<label>
				Name
				<input name="name" autocomplete="name" placeholder="Required for registration" />
			</label>

			{#if form?.message}
				<p class="form-error">{form.message}</p>
			{/if}

			<div class="actions">
				<button class="primary">Sign in</button>
				<button class="secondary" formaction="?/signUpEmail">Register</button>
			</div>
		</form>
	</section>
</main>

<style>
	.login-shell {
		display: grid;
		min-height: 100vh;
		place-items: center;
		padding: 24px;
		background:
			linear-gradient(135deg, rgba(31, 41, 55, 0.06), transparent 38%),
			linear-gradient(315deg, rgba(22, 163, 74, 0.09), transparent 36%),
			#f7f7f4;
	}

	.login-panel {
		display: grid;
		gap: 24px;
		width: min(100%, 420px);
		padding: 28px;
		border: 1px solid #d8d9d2;
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 20px 50px rgba(31, 41, 51, 0.1);
	}

	.eyebrow {
		margin: 0 0 8px;
		color: #0f766e;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 5vw, 2.3rem);
		line-height: 1.05;
	}

	form {
		display: grid;
		gap: 16px;
	}

	label {
		display: grid;
		gap: 7px;
		color: #374151;
		font-size: 0.92rem;
		font-weight: 650;
	}

	input {
		width: 100%;
		border: 1px solid #cbd5d1;
		border-radius: 7px;
		padding: 11px 12px;
		background: #fbfbf8;
		color: #1f2933;
	}

	input:focus {
		border-color: #0f766e;
		outline: 3px solid rgba(15, 118, 110, 0.14);
	}

	.form-error {
		margin: 0;
		color: #b42318;
		font-weight: 650;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	button {
		min-height: 42px;
		border: 1px solid transparent;
		border-radius: 7px;
		font-weight: 750;
	}

	.primary {
		background: #183b56;
		color: #ffffff;
	}

	.secondary {
		border-color: #cbd5d1;
		background: #ffffff;
		color: #1f2933;
	}

	@media (max-width: 520px) {
		.actions {
			grid-template-columns: 1fr;
		}
	}
</style>
