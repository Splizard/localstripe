/*
 * Copyright 2017 Adrien Vergé
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// First, get the URL base from which this script is pulled:
const LOCALSTRIPE_BASE_API = (function () {
  const src = document.currentScript.src;
  if (src.match(/\/js\.stripe\.com\/v3\/$/)) {
    return src.replace(/\/js\.stripe\.com\/v3\/$/, '');
  } else {
    return src.match(/https?:\/\/[^\/]*/)[0];
  }
})();

// Check and warn if the real Stripe is already used in webpage
(function () {
  var iframes = document.getElementsByTagName('iframe');

  for (var i = 0; i < iframes.length; i++) {
    if (iframes[i].getAttribute('name').startsWith('__privateStripeFrame')) {
      console.log('localstripe: Stripe seems to be already used in page ' +
                  '(found a <iframe name="' + iframes[i].getAttribute('name') +
                  '"> in document). For the mock service to work, you need to' +
                  ' include its JavaScript library *before* creating Stripe ' +
                  'elements in the page.');
      //var fakeInput = document.createElement('input');
      //fakeInput.setAttribute('type', 'text');
      //fakeInput.setAttribute('value', 'coucou toi');

      //iframes[i].parentElement.insertBefore(fakeInput, iframes[i]);
      //iframes[i].parentElement.removeChild(iframes[i]);
    }
  }
})();

function openModal(text, confirmText, cancelText) {
  return new Promise(resolve => {
    const box = document.createElement('div'),
          p = document.createElement('p'),
          confirm = document.createElement('button'),
          cancel = document.createElement('button');
    box.appendChild(p);
    box.appendChild(confirm);
    box.appendChild(cancel);
    Object.assign(box.style, {
      position: 'absolute',
      width: '300px',
      top: '50%',
      left: '50%',
      margin: '-35px 0 0 -150px',
      padding: '10px 20px',
      border: '3px solid #ccc',
      background: '#fff',
      'text-align': 'center',
    });
    p.innerText = text;
    confirm.innerText = confirmText;
    cancel.innerText = cancelText;
    document.body.appendChild(box);
    confirm.addEventListener('click', () => {
      document.body.removeChild(box);
      resolve(true);
    });
    cancel.addEventListener('click', () => {
      document.body.removeChild(box);
      resolve(false);
    });
    confirm.focus();
  });
}

// The Element types this mock can render: the all-in-one `card`, and the
// `cardNumber`, `cardExpiry` and `cardCvc` trio a page lays out itself, which
// together stand for one card (as with the real Stripe.js, an action given any
// of the three uses all the split card Elements of its `elements()` group).
const elementFields = {
  card: ['number', 'exp_month', 'exp_year', 'cvc', 'postal_code'],
  cardNumber: ['number'],
  cardExpiry: ['expiry'],
  cardCvc: ['cvc'],
};

function cardBrand(number) {
  if (/^4/.test(number)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  return 'unknown';
}

class Element {
  constructor(stripeElements, type) {
    // Element needs a reference to the object that created it, in order to
    // thoroughly destroy() itself.
    this._stripeElements = stripeElements;
    this._componentName = type;
    this.listeners = {};
    this._domChildren = [];
    this.value = {};
  }

  mount(domElement) {
    if (typeof domElement === 'string') {
      domElement = document.querySelector(domElement);
    } else if (!(domElement instanceof window.Element)) {
      throw new Error('Invalid DOM element. Make sure to call mount() with ' +
                      'a valid DOM element or selector.');
    }

    if (!this._stripeElements._elements.includes(this)) {
      throw new Error('This Element has already been destroyed. Please ' +
                      'create a new one.');
    }

    if (this._domChildren.length) {
      if (domElement === this._domChildren[0].parentElement) {
        return;
      }
      throw new Error('This Element is already mounted. Use `unmount()` to ' +
                      'unmount the Element before re-mounting.');
    }

    if (this._componentName === 'card') {
      const labelSpan = document.createElement('span');
      labelSpan.textContent = 'localstripe: ';
      this._domChildren.push(labelSpan);
    }

    const fields = elementFields[this._componentName];
    this._inputs = {};
    fields.forEach(field => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('placeholder', field === 'expiry' ? 'MM / YY' : field);
      input.setAttribute('size', field === 'number' ? 16 :
                         field === 'postal_code' ? 5 :
                         field === 'expiry' ? 7 : 3);
      input.oninput = event => this._changed(event);
      input.onfocus = () => this._emit('focus', {elementType: this._componentName});
      input.onblur = () => this._emit('blur', {elementType: this._componentName});
      this._inputs[field] = input;
      this._domChildren.push(input);
    });

    this._domChildren.forEach((child) => domElement.appendChild(child));
    setTimeout(() => this._emit('ready', {elementType: this._componentName}));
  }

  // _card returns what this Element holds of the card, by Stripe field name.
  _card() {
    const card = {};
    if (!this._inputs) {
      return card;
    }
    Object.keys(this._inputs).forEach(field => {
      const value = this._inputs[field].value.trim();
      if (field === 'expiry') {
        const [month, year] = value.split('/').map(v => v.trim());
        card.exp_month = month || '';
        card.exp_year = year ? (year.length === 2 ? '20' + year : year) : '';
      } else if (field === 'exp_year') {
        card.exp_year = value.length === 2 ? '20' + value : value;
      } else if (field === 'number') {
        card.number = value.replace(/\s+/g, '');
      } else {
        card[field] = value;
      }
    });
    return card;
  }

  _complete(card) {
    switch (this._componentName) {
      case 'cardNumber': return card.number.length >= 14;
      case 'cardExpiry': return card.exp_month !== '' && card.exp_year.length === 4;
      case 'cardCvc': return card.cvc.length >= 3;
      default:
        return card.number.length >= 14 && card.exp_month !== '' &&
               card.exp_year.length === 4 && card.cvc.length >= 3;
    }
  }

  _changed(event) {
    const card = this._card();
    const {postal_code, ...rest} = card;
    this.value = {card: rest, postal_code};

    if (this._componentName === 'card') {
      if (event.target === this._inputs.number && card.number.length >= 16) {
        this._inputs.exp_month.focus();
      } else if (event.target === this._inputs.exp_month &&
                 parseInt(card.exp_month) > 1) {
        this._inputs.exp_year.focus();
      } else if (event.target === this._inputs.exp_year &&
                 card.exp_year.length >= 4) {
        this._inputs.cvc.focus();
      } else if (event.target === this._inputs.cvc &&
                 card.cvc.length >= 3) {
        this._inputs.postal_code.focus();
      }
    }

    this._emit('change', {
      elementType: this._componentName,
      empty: Object.values(this._inputs).every(input => input.value === ''),
      complete: this._complete(card),
      error: undefined,
      brand: cardBrand(card.number || this._stripeElements._card().card.number || ''),
      value: postal_code !== undefined ? {postalCode: postal_code} : undefined,
    });
  }

  _emit(event, payload) {
    (this.listeners[event] || []).forEach(handler => handler(payload));
  }

  update(options) {}

  focus() {
    const first = this._inputs && Object.values(this._inputs)[0];
    if (first) first.focus();
  }

  blur() {
    Object.values(this._inputs || {}).forEach(input => input.blur());
  }

  clear() {
    Object.values(this._inputs || {}).forEach(input => { input.value = ''; });
    this.value = {};
  }

  unmount() {
    while (this._domChildren.length) {
      this._domChildren.pop().remove();
    }
    this._inputs = undefined;
  }

  destroy() {
    this.unmount();
    const elements = this._stripeElements._elements;
    if (elements.includes(this)) {
      elements.splice(elements.indexOf(this), 1);
    }
  }

  on(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  }

  off(event, handler) {
    this.listeners[event] = (this.listeners[event] || [])
      .filter(h => h !== handler);
  }
}

// cardOf returns the card an action given element stands for, as
// {card: {number, exp_month, exp_year, cvc}, postal_code}.
function cardOf(element) {
  return element._componentName === 'card'
    ? element.value
    : element._stripeElements._card();
}

// retrieveIntent fetches a PaymentIntent or SetupIntent with the publishable
// key and the intent's client secret, as the browser is allowed to.
async function retrieveIntent(resource, pattern, clientSecret, apiKey, name) {
  try {
    const id = clientSecret.match(pattern)[1];
    const query = new URLSearchParams({key: apiKey, client_secret: clientSecret});
    const response = await fetch(
      `${LOCALSTRIPE_BASE_API}/v1/${resource}/${id}?${query}`);
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200 || body.error) {
      return {error: body.error};
    }
    return {[name]: body};
  } catch (err) {
    return {error: err};
  }
}

Stripe = (apiKey) => {
  return {
    elements: () => {
      return {
        _elements: [],
        create: function(type, options) {
          if (!elementFields[type]) {
            throw new Error(`localstripe: unsupported Element type ${type}`);
          }
          if (this.getElement(type)) {
            throw new Error(`Can only create one Element of type ${type}`);
          }
          const element = new Element(this, type);
          this._elements.push(element);
          return element;
        },
        getElement: function(type) {
          return this._elements.find(e => e._componentName === type) || null;
        },
        // _card merges what the split card Elements of this group hold.
        _card: function() {
          const card = {};
          this._elements.filter(e => e._componentName !== 'card')
            .forEach(e => Object.assign(card, e._card()));
          return {card: {number: '', exp_month: '', exp_year: '', cvc: '', ...card}};
        },
        update: function(options) {},
      };
    },
    createToken: async (element) => {
      console.log('localstripe: Stripe().createToken()');
      let body = [];
      const card = cardOf(element).card;
      Object.keys(card).forEach(field => {
        body.push('card[' + field + ']=' + encodeURIComponent(card[field]));
      });
      body.push('key=' + apiKey);
      body.push('payment_user_agent=localstripe');
      body = body.join('&');
      try {
        const url = `${LOCALSTRIPE_BASE_API}/v1/tokens`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body,
        });
        const res = await response.json().catch(() => ({}));
        if (response.status !== 200 || res.error) {
          return {error: res.error};
        } else {
          return {token: res};
        }
      } catch (err) {
        if (typeof err === 'object' && err.error) {
          return err;
        } else {
          return {error: err};
        }
      }
    },
    createSource: async (source) => {
      console.log('localstripe: Stripe().createSource()');
      try {
        const url = `${LOCALSTRIPE_BASE_API}/v1/sources`;
        const response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify({
            key: apiKey,
            payment_user_agent: 'localstripe',
            ...source,
          }),
        });
        const res = await response.json().catch(() => ({}));
        if (response.status !== 200 || res.error) {
          return {error: res.error};
        } else {
          return {source: res};
        }
      } catch (err) {
        if (typeof err === 'object' && err.error) {
          return err;
        } else {
          return {error: err};
        }
      }
    },
    retrieveSource: () => {}, // TODO
    retrievePaymentIntent: async (clientSecret) => {
      console.log('localstripe: Stripe().retrievePaymentIntent()');
      return retrieveIntent('payment_intents', /^(pi_\w+)_secret_/,
                            clientSecret, apiKey, 'paymentIntent');
    },
    retrieveSetupIntent: async (clientSecret) => {
      console.log('localstripe: Stripe().retrieveSetupIntent()');
      return retrieveIntent('setup_intents', /^(seti_\w+)_secret_/,
                            clientSecret, apiKey, 'setupIntent');
    },

    confirmCardSetup: async (clientSecret, data) => {
      console.log('localstripe: Stripe().confirmCardSetup()');
      try {
        const seti = clientSecret.match(/^(seti_\w+)_secret_/)[1];
        const url = `${LOCALSTRIPE_BASE_API}/v1/setup_intents/${seti}/confirm`;
        if (data.payment_method.card instanceof Element) {
          const value = cardOf(data.payment_method.card);
          data.payment_method.card = value.card;
          if (value.postal_code !== undefined) {
            data.payment_method.billing_details =
              data.payment_method.billing_details || {};
            data.payment_method.billing_details.address =
              data.payment_method.billing_details.address || {};
            data.payment_method.billing_details.address.postal_code =
              data.payment_method.billing_details.address.postal_code ||
              value.postal_code;
          }
        }
        let response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify({
            key: apiKey,
            use_stripe_sdk: true,
            client_secret: clientSecret,
            payment_method_data: {
              type: 'card',
              ...data.payment_method,
            },
          }),
        });
        let body = await response.json().catch(() => ({}));
        if (response.status !== 200 || body.error) {
          return {error: body.error};
        } else if (body.status === 'succeeded') {
          return {error: null, setupIntent: body};
        } else if (body.status === 'requires_action') {
          const url =
            (await openModal('3D Secure\nDo you want to confirm or cancel?',
                             'Complete authentication', 'Fail authentication'))
            ? `${LOCALSTRIPE_BASE_API}/v1/setup_intents/${seti}/confirm`
            : `${LOCALSTRIPE_BASE_API}/v1/setup_intents/${seti}/cancel`;
          response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({
              key: apiKey,
              use_stripe_sdk: true,
              client_secret: clientSecret,
            }),
          });
          body = await response.json().catch(() => ({}));
          if (response.status !== 200 || body.error) {
            return {error: body.error};
          } else if (body.status === 'succeeded') {
            return {error: null, setupIntent: body};
          } else {  // 3D Secure authentication cancelled by user:
            return {error: {message:
              'The latest attempt to set up the payment method has failed ' +
              'because authentication failed.'}};
          }
        } else {
          return {error: {message: `setup_intent has status ${body.status}`}};
        }
      } catch (err) {
        if (typeof err === 'object' && err.error) {
          return err;
        } else {
          return {error: err};
        }
      }
    },
    handleCardSetup:  // deprecated
      async function (clientSecret, element, data) {
        return this.confirmCardSetup(clientSecret, {
          payment_method: {
            card: element,
            ...data.payment_method_data,
          }});
      },
    confirmCardPayment: async (clientSecret, data) => {
      console.log('localstripe: Stripe().confirmCardPayment()');
      try {
        const success = await openModal(
          '3D Secure\nDo you want to confirm or cancel?',
          'Complete authentication', 'Fail authentication');
        const pi = clientSecret.match(/^(pi_\w+)_secret_/)[1];
        const url = `${LOCALSTRIPE_BASE_API}/v1/payment_intents/${pi}` +
                    `/_authenticate?success=${success}`;
        const response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify({
            key: apiKey,
            client_secret: clientSecret,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status !== 200 || body.error) {
          return {error: body.error};
        } else {
          return {paymentIntent: body};
        }
      } catch (err) {
        if (typeof err === 'object' && err.error) {
          return err;
        } else {
          return {error: err};
        }
      }
    },
    handleCardPayment:  // deprecated
      async function (clientSecret, element, data) {
        return this.confirmCardPayment(clientSecret);
      },

    confirmSepaDebitSetup: async (clientSecret, data) => {
      console.log('localstripe: Stripe().confirmSepaDebitSetup()');
      try {
        const seti = clientSecret.match(/^(seti_\w+)_secret_/)[1];
        const url = `${LOCALSTRIPE_BASE_API}/v1/setup_intents/${seti}/confirm`;
        let response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify({
            key: apiKey,
            use_stripe_sdk: true,
            client_secret: clientSecret,
            payment_method_data: {
              type: 'sepa_debit',
              ...data.payment_method,
            },
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status !== 200 || body.error) {
          return {error: body.error};
        } else {
          return {setupIntent: body};
        }
      } catch (err) {
        if (typeof err === 'object' && err.error) {
          return err;
        } else {
          return {error: err};
        }
      }
    },

    createPaymentMethod: async () => {},
  };
};

console.log('localstripe: The Stripe object was just replaced in the page. ' +
            'Stripe elements created from now on will be fake ones, ' +
            `communicating with the mock server at ${LOCALSTRIPE_BASE_API}.`);
