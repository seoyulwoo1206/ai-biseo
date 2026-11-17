const form = document.getElementById('form');
const submit = document.getElementById('submit');
const error = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submit.disabled = true;
  error.textContent = '';
  const res = await window.assistant.login(
    document.getElementById('email').value,
    document.getElementById('password').value,
  );
  if (!res.ok) {
    error.textContent = res.message;
    submit.disabled = false;
  }
});
