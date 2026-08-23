<template>
  <div class="become-drep">
    <!-- Header ------------------------------------------------------------ -->
    <header class="become-drep__header">
      <p class="t-caption become-drep__crumbs">
        {{ $t('navigation.governance') }} · {{ $t('navigation.governanceMe') }} ·
        <span class="become-drep__crumb-current">{{ $t('navigation.becomeDRep') }}</span>
      </p>
      <h1 class="t-display">{{ $t('navigation.becomeDRep') }}</h1>
      <p class="t-body become-drep__intro">{{ $t('governance.becomeDRepIntro') }}</p>
    </header>

    <!-- No DRep key: watch-only wallets never derive one, so there is nothing
         to register and nothing to sign with. -->
    <ErrorState v-if="!drepCredentialHex" :message="$t('governance.watchWalletReadOnly')" />

    <div v-else-if="checkingRegistration" class="become-drep__checking">
      <v-skeleton-loader type="article" />
    </div>

    <!-- Submitted, waiting on the indexer ---------------------------------- -->
    <section v-else-if="showSyncing" class="glass-panel become-drep__panel become-drep__syncing">
      <v-progress-circular indeterminate size="24" width="2" color="primary" />
      <div class="become-drep__syncing-copy">
        <h2 class="t-heading">{{ $t('governance.drepRegistrationSyncing') }}</h2>
        <p class="t-body-sm">{{ $t('governance.drepRegistrationSyncingHint') }}</p>
        <p class="t-caption g-mono become-drep__id">{{ drepIdDisplay }}</p>
      </div>
    </section>

    <!-- Already registered: the retire path -------------------------------- -->
    <section v-else-if="alreadyRegistered" class="become-drep__registered">
      <div class="glass-panel become-drep__panel">
        <div class="become-drep__panel-head">
          <h2 class="t-heading">{{ $t('governance.drepRegisteredTitle') }}</h2>
          <p class="t-body-sm">{{ $t('governance.drepRegisteredHint') }}</p>
        </div>

        <div class="become-drep__facts">
          <div class="become-drep__fact">
            <span class="t-label">{{ $t('governance.myDRepId') }}</span>
            <span class="t-body-sm g-mono become-drep__id">
              {{ truncate(drepIdDisplay) }}<CopyButton small :value="drepIdDisplay" />
            </span>
          </div>
          <div class="become-drep__fact">
            <span class="t-label">{{ $t('governance.drepDepositTitle') }}</span>
            <span class="t-body-lg g-num">{{ depositDisplay }}</span>
            <span class="t-caption">{{ $t('governance.drepDepositRefundCaption') }}</span>
          </div>
        </div>

        <p class="t-body-sm">{{ $t('governance.drepRetireCaption') }}</p>

        <div class="become-drep__footer">
          <GButton
            v-if="!retireTx"
            tier="destructive"
            :loading="building"
            @click="startRetire()"
          >
            {{ $t('governance.drepRetire') }}
          </GButton>
        </div>

        <TransactionAuthSection
          v-if="retireTx"
          :wallet-type="loggedWallet && loggedWallet.type"
          :is-prf-wallet="isPrfWallet"
          :is-signed="isSubmit"
          :loading="loading"
          :password="spendingPassword"
          :password-label="$t('wallet.spendingPassword')"
          :password-rules="passwordRules"
          :submit-text="$t('governance.drepRetire')"
          :submit-elevation="0"
          :show-bt-toggle="!!(loggedWallet && loggedWallet.btSupported) && !isSubmit"
          :is-b-t="isBT"
          :usb-text="$t('governance.usb')"
          :bluetooth-text="$t('governance.bluetooth')"
          @update:password="spendingPassword = $event"
          @update:isBT="isBT = $event"
          @passkey-success="handlePassKeyAuthSuccess"
          @passkey-error="handlePassKeyAuthError"
          @autofill-success="handlePassKeySuccess"
          @autofill-error="handlePassKeyError"
          @submit="sign()"
          @password-field-ref="setPasswordFieldRef"
        />
      </div>
    </section>

    <!-- The three-step registration flow ----------------------------------- -->
    <template v-else>
      <ol class="become-drep__steps">
        <li v-for="step in steps" :key="step.index" class="become-drep__step">
          <button
            type="button"
            class="become-drep__step-btn"
            :class="{ 'become-drep__step-btn--active': step.index === currentStep }"
            :disabled="step.index > furthestStep"
            @click="goToStep(step.index)"
          >
            <span
              class="become-drep__step-dot"
              :class="{
                'become-drep__step-dot--done': step.index < currentStep,
                'become-drep__step-dot--active': step.index === currentStep,
              }"
            >
              <v-icon v-if="step.index < currentStep" size="12">mdi-check</v-icon>
              <template v-else>{{ step.index }}</template>
            </span>
            <span class="t-body-sm become-drep__step-label">{{ step.label }}</span>
          </button>
        </li>
      </ol>

      <div class="become-drep__body">
        <div class="become-drep__main">
          <CustomStepper :steps="steps" :current-step="currentStep">
            <!-- Step 1: profile ------------------------------------------- -->
            <v-stepper-content step="1" class="become-drep__content">
              <div class="glass-panel become-drep__panel">
                <div class="become-drep__panel-head">
                  <h2 class="t-heading">{{ $t('governance.drepProfileStep') }}</h2>
                  <p class="t-body-sm">{{ $t('governance.drepProfileStepHint') }}</p>
                </div>

                <v-text-field
                  v-model="profile.givenName"
                  outlined
                  dense
                  :label="$t('governance.drepGivenName')"
                  :hint="$t('governance.drepGivenNameHint')"
                  :counter="MAX_GIVEN_NAME_LENGTH"
                  :error-messages="errorFor('givenName')"
                  persistent-hint
                  @blur="touch('givenName')"
                />

                <v-textarea
                  v-model="profile.objectives"
                  outlined
                  dense
                  rows="3"
                  auto-grow
                  :label="$t('governance.drepObjectives')"
                  :hint="$t('governance.drepObjectivesHint')"
                  :counter="MAX_PROSE_LENGTH"
                  :error-messages="errorFor('objectives')"
                  persistent-hint
                  @blur="touch('objectives')"
                />

                <v-textarea
                  v-model="profile.motivations"
                  outlined
                  dense
                  rows="3"
                  auto-grow
                  :label="$t('governance.drepMotivations')"
                  :hint="$t('governance.drepMotivationsHint')"
                  :counter="MAX_PROSE_LENGTH"
                  :error-messages="errorFor('motivations')"
                  persistent-hint
                  @blur="touch('motivations')"
                />

                <v-textarea
                  v-model="profile.qualifications"
                  outlined
                  dense
                  rows="3"
                  auto-grow
                  :label="$t('governance.drepQualifications')"
                  :hint="$t('governance.drepQualificationsHint')"
                  :counter="MAX_PROSE_LENGTH"
                  :error-messages="errorFor('qualifications')"
                  persistent-hint
                  @blur="touch('qualifications')"
                />

                <v-text-field
                  v-model="profile.paymentAddress"
                  outlined
                  dense
                  :label="$t('governance.drepPaymentAddressOptional')"
                  :hint="$t('governance.drepOwnPaymentAddressHint')"
                  :error-messages="errorFor('paymentAddress')"
                  persistent-hint
                  @blur="touch('paymentAddress')"
                />
              </div>
            </v-stepper-content>

            <!-- Step 2: deposit, keys, hosting ---------------------------- -->
            <v-stepper-content step="2" class="become-drep__content">
              <div class="glass-panel become-drep__panel">
                <div class="become-drep__panel-head">
                  <h2 class="t-heading">{{ $t('governance.drepStepDepositKeys') }}</h2>
                  <p class="t-body-sm">{{ $t('governance.drepStepDepositKeysHint') }}</p>
                </div>

                <div class="become-drep__facts">
                  <div class="become-drep__fact">
                    <span class="t-label">{{ $t('governance.drepDepositTitle') }}</span>
                    <span class="t-body-lg g-num">{{ depositDisplay }}</span>
                    <span class="t-caption">{{ $t('governance.drepDepositCaption') }}</span>
                  </div>
                  <div class="become-drep__fact">
                    <span class="t-label">{{ $t('governance.myDRepId') }}</span>
                    <span class="t-body-sm g-mono become-drep__id">
                      {{ truncate(drepIdDisplay) }}<CopyButton small :value="drepIdDisplay" />
                    </span>
                    <span class="t-caption">{{ $t('governance.drepIdCaption') }}</span>
                  </div>
                </div>

                <!-- Hosting: the wallet builds and hashes, the user hosts. -->
                <div class="become-drep__hosting">
                  <div class="become-drep__panel-head">
                    <h3 class="t-body-lg">{{ $t('governance.drepHostingStep') }}</h3>
                    <p class="t-body-sm">{{ $t('governance.drepHostingStepHint') }}</p>
                  </div>

                  <div class="become-drep__hosting-row">
                    <GButton tier="secondary" compact @click="downloadDocument()">
                      <v-icon left size="16">mdi-download</v-icon>
                      {{ $t('governance.drepDownloadFile') }}
                    </GButton>
                    <CopyButton small :value="anchor.text" />
                    <span class="t-caption">{{ $t('governance.metadataDocument') }}</span>
                  </div>

                  <div class="become-drep__hash">
                    <span class="t-label">{{ $t('governance.drepAnchorHash') }}</span>
                    <span class="t-caption g-mono become-drep__hash-value">
                      {{ anchor.hash }}<CopyButton x-small :value="anchor.hash" />
                    </span>
                  </div>

                  <v-text-field
                    v-model="anchorUrl"
                    outlined
                    dense
                    :label="$t('governance.drepAnchorUrl')"
                    :hint="$t('governance.drepAnchorUrlHint')"
                    :error-messages="anchorUrlError"
                    persistent-hint
                    @blur="touch('anchorUrl')"
                  />

                  <div class="become-drep__verify">
                    <div class="become-drep__verify-head">
                      <span class="t-label">{{ $t('governance.drepVerifyFile') }}</span>
                      <v-tooltip bottom max-width="320">
                        <template #activator="{ on, attrs }">
                          <v-icon size="14" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
                        </template>
                        <span class="t-caption">{{ $t('governance.drepVerifyNoFetch') }}</span>
                      </v-tooltip>
                    </div>
                    <p class="t-body-sm">{{ $t('governance.drepVerifyHint') }}</p>
                    <div class="become-drep__hosting-row">
                      <GButton tier="secondary" compact @click="pickFile()">
                        <v-icon left size="16">mdi-file-upload-outline</v-icon>
                        {{ $t('governance.drepVerifyUpload') }}
                      </GButton>
                      <span v-if="anchorVerified" class="t-body-sm become-drep__ok">
                        <v-icon size="14" color="success">mdi-shield-check-outline</v-icon>
                        {{ $t('governance.drepVerifyMatch') }}
                      </span>
                      <span v-else-if="verification" class="t-body-sm become-drep__bad">
                        <v-icon size="14" color="error">mdi-alert-circle-outline</v-icon>
                        {{ $t('governance.drepVerifyMismatch', { hash: verification.hash }) }}
                      </span>
                      <span v-else class="t-caption">{{ $t('governance.drepVerifyPending') }}</span>
                    </div>
                    <input
                      ref="fileInput"
                      type="file"
                      accept=".json,.jsonld,application/json"
                      class="become-drep__file-input"
                      @change="onFileChosen"
                    />
                  </div>
                </div>

                <!-- Acknowledgements -->
                <div class="become-drep__acks">
                  <span class="t-label">{{ $t('governance.drepBeforeYouSign') }}</span>
                  <v-checkbox v-model="ackPublic" dense hide-details>
                    <template #label>
                      <span class="t-body-sm">{{ $t('governance.drepAcknowledgePublic') }}</span>
                    </template>
                  </v-checkbox>
                  <v-checkbox v-model="ackInactivity" dense hide-details>
                    <template #label>
                      <span class="t-body-sm">{{ $t('governance.drepAcknowledgeInactivity') }}</span>
                    </template>
                  </v-checkbox>
                  <v-checkbox v-model="ackVotes" dense hide-details>
                    <template #label>
                      <span class="t-body-sm">{{ $t('governance.drepAcknowledgeVotes') }}</span>
                    </template>
                  </v-checkbox>
                </div>
              </div>
            </v-stepper-content>

            <!-- Step 3: review and sign ----------------------------------- -->
            <v-stepper-content step="3" class="become-drep__content">
              <div class="glass-panel become-drep__panel">
                <div class="become-drep__panel-head">
                  <h2 class="t-heading">{{ $t('governance.drepReviewStep') }}</h2>
                  <p class="t-body-sm">{{ $t('governance.drepReviewStepHint') }}</p>
                </div>

                <ErrorState
                  v-if="buildError"
                  :message="buildError"
                  retryable
                  @retry="buildRegistration()"
                />

                <div v-else-if="building" class="become-drep__content-loading">
                  <v-skeleton-loader type="list-item-three-line" />
                </div>

                <!-- `buildIsStale` covers "nothing built" as well as "built for
                     a different anchor", so a superseded transaction can never
                     render under the verified badge. -->
                <template v-else-if="!buildIsStale">
                  <dl class="become-drep__summary">
                    <div class="become-drep__summary-row">
                      <dt class="t-body-sm">{{ $t('governance.registrationCertificate') }}</dt>
                      <dd class="t-caption g-mono">reg_drep_cert</dd>
                    </div>
                    <div class="become-drep__summary-row">
                      <dt class="t-body-sm">{{ $t('governance.drepDepositTitle') }}</dt>
                      <dd class="t-body-sm g-num">{{ depositDisplay }}</dd>
                    </div>
                    <div class="become-drep__summary-row">
                      <dt class="t-body-sm">{{ $t('governance.txFee') }}</dt>
                      <dd class="t-body-sm g-num">{{ feeDisplay }}</dd>
                    </div>
                    <!-- Both halves of the anchor are shown, because both are
                         what the signature commits to permanently. -->
                    <div class="become-drep__summary-row">
                      <dt class="t-body-sm">{{ $t('governance.drepAnchorUrl') }}</dt>
                      <dd class="t-caption g-mono become-drep__summary-url">{{ anchorUrl }}</dd>
                    </div>
                    <div class="become-drep__summary-row become-drep__summary-row--last">
                      <dt class="t-body-sm">{{ $t('governance.metadataAnchor') }}</dt>
                      <dd class="t-body-sm become-drep__ok">
                        <v-icon size="14" color="success">mdi-shield-check-outline</v-icon>
                        {{ $t('governance.drepVerifyMatch') }}
                      </dd>
                    </div>
                  </dl>

                  <p class="t-caption">{{ $t('governance.drepSigningHint') }}</p>

                  <TransactionAuthSection
                    :wallet-type="loggedWallet && loggedWallet.type"
                    :is-prf-wallet="isPrfWallet"
                    :is-signed="isSubmit"
                    :loading="loading"
                    :password="spendingPassword"
                    :password-label="$t('wallet.spendingPassword')"
                    :password-rules="passwordRules"
                    :submit-text="$t('governance.signAndRegister')"
                    :submit-elevation="0"
                    :show-bt-toggle="!!(loggedWallet && loggedWallet.btSupported) && !isSubmit"
                    :is-b-t="isBT"
                    :usb-text="$t('governance.usb')"
                    :bluetooth-text="$t('governance.bluetooth')"
                    @update:password="spendingPassword = $event"
                    @update:isBT="isBT = $event"
                    @passkey-success="handlePassKeyAuthSuccess"
                    @passkey-error="handlePassKeyAuthError"
                    @autofill-success="handlePassKeySuccess"
                    @autofill-error="handlePassKeyError"
                    @submit="sign()"
                    @password-field-ref="setPasswordFieldRef"
                  />
                </template>

                <EmptyState v-else :message="$t('governance.noTransactionToSign')" />
              </div>
            </v-stepper-content>
          </CustomStepper>

          <div class="become-drep__footer">
            <GButton v-if="currentStep > 1" tier="tertiary" compact @click="goBack()">
              {{ $t('governance.back') }}
            </GButton>
            <span class="become-drep__footer-gap"></span>
            <GButton
              v-if="currentStep < 3"
              tier="primary"
              :disabled="!canContinue"
              :loading="building"
              @click="goNext()"
            >
              {{ continueLabel }}
            </GButton>
          </div>
        </div>

        <!-- Right column: the live preview ------------------------------- -->
        <aside class="become-drep__side">
          <div class="glass-panel become-drep__panel become-drep__panel--tight">
            <span class="t-label">{{ $t('governance.drepDirectoryPreview') }}</span>
            <div class="become-drep__preview">
              <div class="become-drep__preview-head">
                <span class="become-drep__avatar">
                  <v-icon size="16">mdi-account-outline</v-icon>
                </span>
                <span class="become-drep__preview-name">
                  <span class="t-body">{{ previewName }}</span>
                  <span class="t-caption g-mono">{{ truncate(drepIdDisplay) }}</span>
                </span>
              </div>
              <p class="t-caption become-drep__preview-blurb">{{ previewBlurb }}</p>
              <div class="become-drep__preview-tags">
                <span class="t-caption become-drep__chip">{{ $t('governance.drepNewBadge') }}</span>
                <span class="t-caption">{{ $t('governance.drepNewBadgeHint') }}</span>
              </div>
            </div>
            <span class="t-caption">{{ $t('governance.drepPreviewCaption') }}</span>
          </div>

          <div class="glass-panel become-drep__panel become-drep__panel--tight become-drep__note">
            <v-icon size="16" color="warning">mdi-alert-outline</v-icon>
            <p class="t-caption">
              {{ $t('governance.drepCommitmentNote') }}
              <a :href="GOV_TOOLS_DOCS" target="_blank" rel="noopener noreferrer">
                {{ $t('governance.drepCommitmentLink') }}
              </a>
            </p>
          </div>
        </aside>
      </div>
    </template>

    <KeystoneSignDialog
      :isOpen="!!overlay && !!loggedWallet && loggedWallet.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="overlay = false"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';

import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import blockchainApi from '@/api/blockchain-api';
import {
  nexusTxApi,
  walletUtxosToNexusInputs,
  type BuildDRepRegistrationTxRequest,
} from '@/api/nexus-tx-api';
import { toLovelace } from '@/shared/utils/lovelace';
import filters from '@/shared/utils/filters';
import { isCardanoTx } from '@/models/transaction.types';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import { debugLog } from '@/utils/debug';
import {
  buildCip119Anchor,
  isAnchorUrl,
  validateCip119Profile,
  verifyUploadedBytes,
  MAX_GIVEN_NAME_LENGTH,
  MAX_PROSE_LENGTH,
  type Cip119Profile,
  type Cip119Verification,
} from '@/shared/utils/cip119';
import { anchorIdentity, isRegisteredDRep } from '@/modules/governance/views/becomeDRep.state';

import CustomStepper from '@/shared/components/CustomStepper.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

const { t } = useTranslation();
const { truncate, toCurrency } = filters;

/** Ours, not author-controlled, so it is a plain rel-guarded link. */
const GOV_TOOLS_DOCS = 'https://docs.gov.tools';

// ---------------------------------------------------------------------------
// Wallet identity
// ---------------------------------------------------------------------------

const loggedWallet = computed(() => walletStore.loggedWallet);

/**
 * The wallet's own DRep credential. `drep129[0].cred` is the 28-byte key hash
 * as 56 hex chars, which is exactly what the Nexus builder wants. Watch wallets
 * derive no DRep keys at all, so this is empty for them and the flow refuses.
 */
const drepCredentialHex = computed(() => walletStore.keys?.drep129?.[0]?.cred ?? '');
const drepIdDisplay = computed(() => walletStore.keys?.drep129?.[0]?.address ?? '');

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

/**
 * Informational only. The certificate's deposit is set server-side from the
 * node's own protocol parameters when the transaction is built, so this figure
 * cannot make the transaction wrong; it exists so the user knows what is about
 * to be locked before they get there.
 */
const depositLovelace = computed(() => toLovelace(networkStore.epochParams?.dRepDeposit));
const depositDisplay = computed(() => toCurrency(depositLovelace.value.toString()));

// ---------------------------------------------------------------------------
// Step 1: the CIP-119 profile
// ---------------------------------------------------------------------------

const profile = reactive<Cip119Profile>({
  givenName: '',
  objectives: '',
  motivations: '',
  qualifications: '',
  paymentAddress: '',
});

const issues = computed(() => validateCip119Profile(profile));
const profileValid = computed(() => issues.value.length === 0);

/** The document, its bytes and its hash, rebuilt on every keystroke. */
const anchor = computed(() => buildCip119Anchor(profile));

const touched = reactive<Record<string, boolean>>({});
const showErrors = ref(false);

function touch(field: string): void {
  touched[field] = true;
}

// Only the codes this form can actually produce. `invalidUri` and `tooMany`
// belong to the image and references fields, which cip119.ts supports but this
// form does not collect; if either ever surfaces here the fallback fires rather
// than a key nobody wrote.
const ISSUE_KEYS: Record<string, string> = {
  required: 'common.required',
  tooLong: 'governance.drepFieldTooLong',
  invalidAddress: 'governance.drepPaymentAddressInvalid',
};

function errorFor(field: keyof Cip119Profile): string[] {
  if (!showErrors.value && !touched[field]) return [];
  const issue = issues.value.find((candidate) => candidate.field === field);
  return issue ? [t(ISSUE_KEYS[issue.code] ?? 'errors.unknownError')] : [];
}

const previewName = computed(() => profile.givenName.trim() || t('governance.drepPreviewNamePlaceholder'));
const previewBlurb = computed(
  () => profile.objectives.trim() || t('governance.drepPreviewBlurbPlaceholder')
);

// ---------------------------------------------------------------------------
// Step 2: hosting, hash verification, acknowledgements
// ---------------------------------------------------------------------------

const anchorUrl = ref('');
const anchorUrlValid = computed(() => isAnchorUrl(anchorUrl.value));
const anchorUrlError = computed(() => {
  if (!showErrors.value && !touched['anchorUrl']) return [];
  if (!anchorUrl.value.trim()) return [t('common.required')];
  return anchorUrlValid.value ? [] : [t('governance.drepAnchorUrlInvalid')];
});

const verification = ref<Cip119Verification | null>(null);
/**
 * The hash that was actually verified. Kept separately so that editing the
 * profile after a successful upload invalidates the check instead of silently
 * carrying it forward onto a document the user never hosted.
 */
const verifiedAgainst = ref('');
const anchorVerified = computed(
  () => !!verification.value?.verified && verifiedAgainst.value === anchor.value.hash
);

const fileInput = ref<HTMLInputElement | null>(null);

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Clear immediately so re-picking the same file fires `change` again.
  input.value = '';
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    verification.value = verifyUploadedBytes(anchor.value.hash, bytes);
    verifiedAgainst.value = anchor.value.hash;
  } catch (error) {
    debugLog('BecomeDRep: could not read the uploaded file', error);
    snackbar.setError(t('governance.drepVerifyReadFailed'));
  }
}

function downloadDocument(): void {
  // The bytes handed over here are the same ones that were hashed — that is the
  // whole point of routing both through buildCip119Anchor.
  const blob = new Blob([anchor.value.bytes], { type: 'application/ld+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'drep-metadata.jsonld';
  link.click();
  URL.revokeObjectURL(url);
}

const ackPublic = ref(false);
const ackInactivity = ref(false);
const ackVotes = ref(false);
const acknowledged = computed(() => ackPublic.value && ackInactivity.value && ackVotes.value);

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

const currentStep = ref(1);
const furthestStep = ref(1);

const steps = computed(() => [
  { index: 1, name: 'profile', label: t('governance.drepProfileStep') },
  { index: 2, name: 'deposit', label: t('governance.drepStepDepositKeys') },
  { index: 3, name: 'review', label: t('governance.drepReviewStep') },
]);

const canContinue = computed(() => {
  if (currentStep.value === 1) return profileValid.value;
  if (currentStep.value === 2) return anchorUrlValid.value && anchorVerified.value && acknowledged.value;
  return false;
});

const continueLabel = computed(() =>
  currentStep.value === 1 ? t('governance.continueToDeposit') : t('governance.continueToReview')
);

async function goToStep(step: number): Promise<void> {
  if (step > furthestStep.value) return;
  currentStep.value = step;
  // Jumping straight back to review must rebuild whatever the form now says.
  // Without this, the pill is a way around goNext's rebuild.
  if (step === 3 && buildIsStale.value) await buildRegistration();
}

function goBack(): void {
  showErrors.value = false;
  currentStep.value = Math.max(1, currentStep.value - 1);
}

async function goNext(): Promise<void> {
  if (!canContinue.value) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  currentStep.value += 1;
  furthestStep.value = Math.max(furthestStep.value, currentStep.value);
  if (currentStep.value === 3 && buildIsStale.value) await buildRegistration();
}

// ---------------------------------------------------------------------------
// Step 3: build, sign, submit
// ---------------------------------------------------------------------------

const txData = ref<Cardano.Tx | undefined>(undefined);
const building = ref(false);
const buildError = ref('');
const estimatedFee = ref('');
/** Set once a retirement has been built, so the panel swaps to the auth section. */
const retireTx = ref(false);
const submitted = ref(false);

/**
 * The anchor the built registration was built FOR. Empty when nothing is built.
 *
 * The transaction commits to a specific (url, hash) pair, so it stays valid only
 * while both still match the form. Comparing against this is what stops an
 * edited URL from being signed under a transaction anchored at the old one: the
 * watcher below clears eagerly, and this guard means no navigation path can
 * render or sign a stale build even if the clearing is bypassed.
 */
const builtFor = ref('');
const currentAnchor = computed(() => anchorIdentity(anchorUrl.value, anchor.value.hash));
const buildIsStale = computed(() => !txData.value || builtFor.value !== currentAnchor.value);

// Four decimals, not the formatter's default two: a network fee is fractional
// ADA and rounding it to cents hides most of it.
const feeDisplay = computed(() =>
  estimatedFee.value ? toCurrency(estimatedFee.value, false, 4) : t('common.notAvailable')
);

async function buildTx(overrides: Partial<BuildDRepRegistrationTxRequest>): Promise<void> {
  const wallet = loggedWallet.value;
  const changeAddress = walletStore.keys?.payment?.[0]?.address;
  if (!wallet || !changeAddress || !drepCredentialHex.value) {
    buildError.value = t('errors.buildTransactionFailed');
    return;
  }

  building.value = true;
  buildError.value = '';
  try {
    const response = await nexusTxApi.buildDRepRegistrationTx(
      {
        drepCredentialHash: drepCredentialHex.value,
        changeAddress,
        utxos: walletUtxosToNexusInputs(
          (walletStore.utxos ?? []) as Cardano.Utxo[],
          walletStore.collateral
        ),
        ...overrides,
      },
      wallet.network
    );
    if (!response.tx_cbor) throw new Error('Nexus returned an empty transaction CBOR');
    txData.value = Serialization.Transaction.fromCbor(HexBlob(response.tx_cbor)).toCore();
    estimatedFee.value = response.estimated_fee ?? '';
  } catch (error) {
    debugLog('BecomeDRep: build failed', error);
    buildError.value = `${t('errors.buildTransactionFailed')}: ${
      error instanceof Error ? error.message : t('errors.unknownError')
    }`;
  } finally {
    building.value = false;
  }
}

async function buildRegistration(): Promise<void> {
  // Snapshot the anchor being built BEFORE the await, and record it only on
  // success, so a failed or superseded build never marks itself current.
  const target = currentAnchor.value;
  builtFor.value = '';
  await buildTx({
    anchorUrl: anchorUrl.value.trim(),
    anchorDataHash: anchor.value.hash,
    deregister: false,
  });
  if (txData.value && !buildError.value) builtFor.value = target;
}

async function startRetire(): Promise<void> {
  // The builder emits UnregDRepCert and folds the deposit refund in as a
  // negative implicit deposit, so no anchor and no amount are sent.
  signingOptions.successMessageKey = 'governance.drepRetireTxSubmitted';
  await buildTx({ deregister: true });
  retireTx.value = !!txData.value;
  if (buildError.value) snackbar.setError(buildError.value);
}

/**
 * Held as a named object so the retire branch can swap the confirmation copy:
 * the composable reads `successMessageKey` when the submit succeeds, not when
 * it is constructed, so registering and retiring do not have to share a
 * message. Both branches are mutually exclusive, so one signing state is enough.
 */
const signingOptions = {
  tx: txData,
  successMessageKey: 'governance.drepRegistrationTxSubmitted',
  onSuccess: () => {
    submitted.value = true;
  },
};

const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  passwordRules,
  isPrfWallet,
  handleSign,
  handlePassKeySuccess,
  handlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
  setPasswordFieldRef,
  overlay,
  keystoneType,
  keystoneCbor,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning(signingOptions);

async function sign(): Promise<void> {
  await handleSign();
}

// Changing EITHER half of the anchor invalidates the review step. Editing the
// profile changes the hash and also breaks the hosted-file verification; editing
// the URL alone leaves the document untouched but still points the certificate
// somewhere else, and that is just as permanent. Both drop the built
// transaction and pull the flow back to step 2.
watch(currentAnchor, () => {
  if (furthestStep.value > 2 && currentStep.value < 3) furthestStep.value = 2;
  txData.value = undefined;
  builtFor.value = '';
});

// ---------------------------------------------------------------------------
// Registration state: on-chain lookup plus the pending-tx scan
// ---------------------------------------------------------------------------

const alreadyRegistered = ref(false);
const checkingRegistration = ref(true);

const DREP_REGISTRATION_CERTS = [
  Cardano.CertificateType.RegisterDelegateRepresentative,
  Cardano.CertificateType.UnregisterDelegateRepresentative,
];

/**
 * True while a registration or retirement is submitted but not yet confirmed.
 * Mirrors the scan CardanoGovernance/useDelegation use: every pending tx is
 * checked, because an unrelated pending send must not hide this state.
 */
const registrationPending = computed(() =>
  (walletStore.transactions ?? []).some(
    (tx) =>
      tx.pending &&
      isCardanoTx(tx) &&
      (tx.body?.certificates ?? []).some((cert: Cardano.Certificate) =>
        DREP_REGISTRATION_CERTS.includes(cert.__typename)
      )
  )
);

/**
 * Optimistic: the indexer lags the chain by a block or two, so the moment the
 * transaction is accepted the flow switches to "syncing" rather than bouncing
 * the user back to a form they already completed.
 */
const showSyncing = computed(() => submitted.value || registrationPending.value);

async function loadRegistration(): Promise<void> {
  const wallet = loggedWallet.value;
  if (!wallet || !drepIdDisplay.value) {
    checkingRegistration.value = false;
    return;
  }
  try {
    const record = await blockchainApi.getDRepById(drepIdDisplay.value, wallet.chain, wallet.network);
    // Not `!!record`: a RETIRED DRep still has a row, carrying registered:false.
    // Keying off the row's existence alone stranded a retired user on the retire
    // panel with no way to register again. See isRegisteredDRep for the polarity.
    alreadyRegistered.value = isRegisteredDRep(record);
  } catch (error) {
    // A lookup failure is not proof of anything, so stay on the registration
    // flow rather than claiming the user is or is not registered.
    debugLog('BecomeDRep: DRep lookup failed', error);
    alreadyRegistered.value = false;
  } finally {
    checkingRegistration.value = false;
  }
}

onMounted(loadRegistration);
</script>

<style scoped>
.become-drep {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-5);
  padding: var(--g-s-4);
  max-width: var(--g-content-max);
}

.become-drep__header {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.become-drep__crumbs {
  margin: 0;
}

.become-drep__crumb-current {
  color: var(--g-text-2);
}

.become-drep__intro {
  margin: 0;
  max-width: 68ch;
}

/* Step rail --------------------------------------------------------------- */

.become-drep__steps {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  list-style: none;
  padding: 0;
  margin: 0;
}

.become-drep__step + .become-drep__step {
  border-left: 1px solid var(--g-hairline-3);
  padding-left: var(--g-s-3);
}

.become-drep__step-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: var(--g-text-3);
  transition: color var(--g-dur-fast) var(--g-ease);
}

.become-drep__step-btn:disabled {
  cursor: default;
}

.become-drep__step-btn--active .become-drep__step-label {
  color: var(--g-text-1);
}

.become-drep__step-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--g-text-3);
}

.become-drep__step-dot--active {
  border-color: var(--g-accent);
  color: var(--g-accent);
}

.become-drep__step-dot--done {
  background: var(--g-grad);
  border-color: transparent;
  color: var(--g-on-grad);
}

.become-drep__step-dot--done .v-icon {
  color: var(--g-on-grad);
}

/* Body layout ------------------------------------------------------------- */

.become-drep__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--g-s-4);
  align-items: start;
}

@media (max-width: 1100px) {
  .become-drep__body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.become-drep__main,
.become-drep__side {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-width: 0;
}

.become-drep__content {
  padding: 0;
}

.become-drep__panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
}

.become-drep__panel--tight {
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.become-drep__panel-head {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.become-drep__panel-head p,
.become-drep__panel-head h2,
.become-drep__panel-head h3 {
  margin: 0;
}

/* Fact cards -------------------------------------------------------------- */

.become-drep__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--g-s-3);
}

.become-drep__fact {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.become-drep__id {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  word-break: break-all;
}

/* Hosting ----------------------------------------------------------------- */

.become-drep__hosting,
.become-drep__verify,
.become-drep__acks {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.become-drep__hosting-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}

.become-drep__hash {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.become-drep__hash-value {
  word-break: break-all;
}

.become-drep__verify-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.become-drep__verify p {
  margin: 0;
}

.become-drep__file-input {
  display: none;
}

.become-drep__ok {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-success);
}

.become-drep__bad {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-error);
}

/* Review summary ---------------------------------------------------------- */

.become-drep__summary {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}

.become-drep__summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.become-drep__summary-row dt,
.become-drep__summary-row dd {
  margin: 0;
}

.become-drep__summary-row--last {
  border-top: 1px solid var(--g-hairline-1);
  padding-top: var(--g-s-2);
}

.become-drep__summary-url {
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
}

/* Footer ------------------------------------------------------------------ */

.become-drep__footer {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.become-drep__footer-gap {
  flex: 1;
}

/* Preview ----------------------------------------------------------------- */

.become-drep__preview {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.become-drep__preview-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.become-drep__avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.become-drep__preview-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.become-drep__preview-blurb {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.become-drep__preview-tags {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  flex-wrap: wrap;
}

.become-drep__chip {
  padding: 2px var(--g-s-2);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-chip);
  color: var(--g-text-2);
}

/* Notes and states -------------------------------------------------------- */

.become-drep__note {
  flex-direction: row;
  align-items: flex-start;
  border-color: var(--g-warning-line);
}

.become-drep__note p {
  margin: 0;
}

.become-drep__syncing {
  flex-direction: row;
  align-items: flex-start;
  gap: var(--g-s-3);
}

.become-drep__syncing-copy {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.become-drep__syncing-copy h2,
.become-drep__syncing-copy p {
  margin: 0;
}
</style>
