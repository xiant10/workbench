// Turns the microphone into 16 kHz mono 16-bit PCM for a voice message, in
// chunks of about 100 ms. It's a file of its own because the content policy
// allows scripts from this site only. See ../src/lib/dictation.ts.
class Dictation extends AudioWorkletProcessor {
	constructor() {
		super();
		this.step = sampleRate / 16000;
		this.position = 0;
		this.out = new Int16Array(1600);
		this.filled = 0;
	}

	process(inputs) {
		const input = inputs[0] && inputs[0][0];
		if (!input) return true;
		// Average each 16 kHz sample's span of input, which also filters out
		// what would alias.
		while (this.position < input.length) {
			const start = Math.floor(this.position);
			const end = Math.min(input.length, Math.max(start + 1, Math.floor(this.position + this.step)));
			let sum = 0;
			for (let i = start; i < end; i++) sum += input[i];
			const sample = Math.max(-1, Math.min(1, sum / (end - start)));
			this.out[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
			if (this.filled === this.out.length) {
				this.port.postMessage(this.out.buffer, [this.out.buffer]);
				this.out = new Int16Array(1600);
				this.filled = 0;
			}
			this.position += this.step;
		}
		this.position -= input.length;
		return true;
	}
}

registerProcessor("dictation", Dictation);
