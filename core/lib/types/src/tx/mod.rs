//! `transactions` is module that holds the essential information for every transaction.
//!
//! Since in zkSync Era every operation can be executed either from the contract or rollup,
//! it makes more sense to define the contents of each transaction chain-agnostic, and extent this data
//! with metadata (such as fees and/or signatures) for L1 and L2 separately.

use std::fmt::Debug;
use zksync_basic_types::{Address, H256};
use zksync_utils::bytecode::CompressedBytecodeInfo;

pub mod execute;
pub mod primitives;
pub mod tx_execution_info;

pub use self::execute::Execute;
use crate::Transaction;
pub use tx_execution_info::ExecutionMetrics;
use tx_execution_info::TxExecutionStatus;

#[derive(Debug, Clone, PartialEq)]
pub struct TransactionExecutionResult {
    pub transaction: Transaction,
    pub hash: H256,
    pub execution_info: ExecutionMetrics,
    pub execution_status: TxExecutionStatus,
    pub refunded_gas: u32,
    pub operator_suggested_refund: u32,
    pub compressed_bytecodes: Vec<CompressedBytecodeInfo>,
}

#[derive(Debug, Clone)]
pub struct IncludedTxLocation {
    pub tx_hash: H256,
    pub tx_index_in_miniblock: u32,
    pub tx_initiator_address: Address,
}
